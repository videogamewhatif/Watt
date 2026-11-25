-- =============================================================================
-- Wattalis · 0009 · Suscripciones SaaS y facturación de la plataforma
--
-- PostgreSQL estándar (Supabase hoy; Amazon RDS PostgreSQL después). Lo único
-- propio de Supabase es auth.uid() en las políticas RLS; en RDS se sustituye por
-- el claim del token de Amazon Cognito (ver docs/SUSCRIPCIONES.md).
--
-- Reglas garantizadas aquí:
--   * Importes en centavos enteros (MXN). Un comprobante cuadra: total = base + IVA.
--   * La suscripción pertenece a una cuenta de facturación de una organización
--     (espacio), nunca a una persona. Un espacio tiene como máximo una
--     suscripción vigente.
--   * El estado solo cambia por transiciones válidas (misma tabla que
--     src/features/billing/state-machine.ts) y cada cambio queda en el historial.
--   * Los eventos de la pasarela son idempotentes (provider_event_id único).
--   * Ninguna cuenta de una clínica escribe en estas tablas: solo lee lo suyo.
--     Los cambios los aplica el procesador de eventos de la pasarela con
--     credenciales de servicio (service_role / rol de la Lambda). Así nadie puede
--     marcar un cobro como pagado desde la aplicación.
--   * La plataforma (equipo Wattalis) se identifica con platform_admins, nunca
--     con el rol Administración de una clínica.
--   * No se guardan números de tarjeta, CVV ni datos bancarios.
--   * Cancelar o dejar de pagar nunca borra información médica ni administrativa
--     (las llaves usan ON DELETE RESTRICT para no perder historial de cobro).
-- =============================================================================

create type public.subscription_status as enum (
  'incomplete', 'trialing', 'active', 'past_due', 'grace_period', 'unpaid', 'canceled', 'expired'
);
create type public.billing_interval as enum ('month', 'year');
create type public.billing_invoice_status as enum ('open', 'paid', 'void', 'uncollectible');
create type public.payment_attempt_status as enum ('pending', 'succeeded', 'failed', 'canceled');
create type public.subscription_change_status as enum ('scheduled', 'applied', 'canceled');
create type public.subscription_event_source as enum ('provider', 'system', 'user', 'platform_admin');
create type public.platform_role as enum ('platform_admin', 'billing_support');

-- -----------------------------------------------------------------------------
-- Equipo de la plataforma
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null default 'platform_admin',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
comment on table public.platform_admins is 'Equipo de Wattalis con acceso al panel global. Se administra fuera de la aplicación.';

-- -----------------------------------------------------------------------------
-- Catálogo comercial (configurable)
-- -----------------------------------------------------------------------------
create table public.billing_settings (
  id boolean primary key default true check (id),
  annual_discount_bps integer not null default 1500 check (annual_discount_bps between 0 and 5000),
  grace_period_days integer not null default 7 check (grace_period_days between 0 and 60),
  tax_rate_bps integer not null default 1600 check (tax_rate_bps between 0 and 3000),
  prices_include_tax boolean not null default true,
  trial_days integer not null default 14 check (trial_days between 0 and 90),
  enforce_limits boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.billing_settings is 'Parámetros comerciales (una fila). enforce_limits activa la verificación de límites en la base.';

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 300),
  monthly_price_cents integer check (monthly_price_cents >= 0),
  annual_price_cents integer check (annual_price_cents >= 0),
  currency char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  is_custom_pricing boolean not null default false,
  badge text check (char_length(badge) <= 30),
  tier smallint not null check (tier between 1 and 99),
  display_order integer not null default 0,
  provider_price_monthly_id text,
  provider_price_annual_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_custom_pricing or (monthly_price_cents is not null and annual_price_cents is not null))
);
comment on column public.subscription_plans.monthly_price_cents is 'Centavos. NULL solo en planes de precio personalizado (Corporativo).';

create table public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans (id) on delete cascade,
  feature_code text not null check (feature_code ~ '^[a-z][a-z0-9_.]{1,59}$'),
  enabled boolean not null default true,
  usage_limit integer check (usage_limit >= 0),
  created_at timestamptz not null default now(),
  unique (plan_id, feature_code)
);
comment on column public.plan_entitlements.usage_limit is 'Solo para límites (*.max). NULL = sin límite.';

-- -----------------------------------------------------------------------------
-- Cuentas de facturación (por organización) y espacios cubiertos
-- -----------------------------------------------------------------------------
create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete restrict,
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 160),
  billing_email text not null check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 120),
  phone text check (char_length(phone) <= 30),
  country char(2) not null default 'MX',
  timezone text not null default 'America/Mexico_City',
  establishment_type text check (char_length(establishment_type) <= 40),
  provider text not null default 'mock' check (provider in ('mock', 'stripe')),
  provider_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_customer_id)
);
comment on table public.billing_accounts is 'Quién paga: siempre una organización (espacio), nunca una persona.';

-- Facturación central (Corporativo): una cuenta paga varios espacios.
create table public.billing_account_workspaces (
  billing_account_id uuid not null references public.billing_accounts (id) on delete cascade,
  workspace_id uuid primary key references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Suscripciones
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts (id) on delete restrict,
  workspace_id uuid references public.organizations (id) on delete restrict,
  plan_id uuid not null references public.subscription_plans (id) on delete restrict,
  provider_subscription_id text unique,
  status public.subscription_status not null default 'incomplete',
  billing_interval public.billing_interval not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  ended_at timestamptz,
  custom_price_cents integer check (custom_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, billing_account_id),
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start),
  check (status <> 'trialing' or trial_ends_at is not null)
);
comment on column public.subscriptions.workspace_id is 'Espacio cubierto. NULL = suscripción central de la cuenta (cubre billing_account_workspaces).';
create unique index subscriptions_one_current_per_workspace on public.subscriptions (workspace_id)
  where workspace_id is not null and status not in ('canceled', 'expired');
create index subscriptions_account_idx on public.subscriptions (billing_account_id);
create index subscriptions_status_idx on public.subscriptions (status, current_period_end);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z_]{3,60}$'),
  source public.subscription_event_source not null,
  provider_event_id text unique,
  actor_id uuid references auth.users (id) on delete set null,
  from_status public.subscription_status,
  to_status public.subscription_status,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on column public.subscription_events.provider_event_id is 'Id del evento en la pasarela. Único: un evento duplicado no se procesa dos veces.';
create index subscription_events_sub_idx on public.subscription_events (subscription_id, created_at desc);

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts (id) on delete restrict,
  subscription_id uuid,
  invoice_reference text not null unique check (char_length(invoice_reference) between 4 and 40),
  description text not null default '' check (char_length(description) <= 200),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  tax_cents integer not null check (tax_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency char(3) not null default 'MXN',
  status public.billing_invoice_status not null default 'open',
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  provider_invoice_id text unique,
  is_demo boolean not null default false,
  check (amount_cents = subtotal_cents + tax_cents),
  check ((status = 'paid') = (paid_at is not null)),
  unique (id, billing_account_id),
  -- El comprobante y la suscripción deben ser de la misma cuenta.
  constraint billing_invoices_subscription_fk foreign key (subscription_id, billing_account_id)
    references public.subscriptions (id, billing_account_id)
);
comment on table public.billing_invoices is 'Comprobante de cobro de la suscripción. NO es un CFDI; is_demo marca los de la demostración.';
create index billing_invoices_account_idx on public.billing_invoices (billing_account_id, issued_at desc);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions (id) on delete restrict,
  invoice_id uuid not null references public.billing_invoices (id) on delete restrict,
  provider_payment_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  status public.payment_attempt_status not null,
  failure_reason text check (char_length(failure_reason) <= 300),
  attempted_at timestamptz not null default now()
);
create index payment_attempts_invoice_idx on public.payment_attempts (invoice_id, attempted_at desc);

create table public.subscription_change_requests (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  from_plan_id uuid not null references public.subscription_plans (id),
  to_plan_id uuid not null references public.subscription_plans (id),
  from_interval public.billing_interval not null,
  to_interval public.billing_interval not null,
  kind text not null check (kind in ('upgrade', 'downgrade')),
  effective_at timestamptz not null,
  status public.subscription_change_status not null default 'scheduled',
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  check (from_plan_id <> to_plan_id or from_interval <> to_interval)
);
create unique index subscription_change_one_scheduled on public.subscription_change_requests (subscription_id) where status = 'scheduled';

-- Solo datos no sensibles; la tarjeta vive en la pasarela.
create table public.billing_payment_methods (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts (id) on delete cascade,
  provider_payment_method_id text not null unique,
  brand text not null check (char_length(brand) between 2 and 30),
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  exp_month smallint not null check (exp_month between 1 and 12),
  exp_year smallint not null check (exp_year between 2000 and 2100),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index billing_payment_methods_one_default on public.billing_payment_methods (billing_account_id) where is_default;

create table public.billing_notifications (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid references public.billing_accounts (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  template text not null check (template ~ '^[a-z_]{3,40}$'),
  recipient text not null,
  subject text not null check (char_length(subject) <= 200),
  status text not null default 'queued' check (status in ('demo_not_sent', 'queued', 'sent', 'failed')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
comment on table public.billing_notifications is 'Bandeja de salida de avisos (Amazon SES en el futuro).';

create table public.billing_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 3 and 80),
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.billing_audit_log is 'Operaciones administrativas de la plataforma (precios, planes, simulaciones).';

-- -----------------------------------------------------------------------------
-- Máquina de estados (misma tabla que state-machine.ts)
-- -----------------------------------------------------------------------------
create function private.subscription_transition_allowed(p_from public.subscription_status, p_to public.subscription_status)
returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from::text || '>' || p_to::text) = any (array[
    'incomplete>active', 'incomplete>trialing', 'incomplete>incomplete', 'incomplete>canceled', 'incomplete>expired',
    'trialing>active', 'trialing>past_due', 'trialing>expired', 'trialing>trialing', 'trialing>canceled',
    'active>active', 'active>past_due', 'active>canceled',
    'past_due>grace_period', 'past_due>active', 'past_due>canceled',
    'grace_period>unpaid', 'grace_period>active', 'grace_period>canceled',
    'unpaid>active', 'unpaid>canceled',
    'canceled>active', 'expired>active'
  ]);
$$;

create function private.tg_subscriptions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('incomplete', 'trialing', 'active') then
      raise exception using errcode = 'P0001', message = 'invalid_initial_subscription_status';
    end if;
    return new;
  end if;
  if new.billing_account_id is distinct from old.billing_account_id or new.workspace_id is distinct from old.workspace_id then
    raise exception using errcode = 'P0001', message = 'subscription_owner_immutable';
  end if;
  if new.status is distinct from old.status and not private.subscription_transition_allowed(old.status, new.status) then
    raise exception using errcode = 'P0001', message = 'invalid_subscription_transition',
      detail = format('%s → %s', old.status, new.status);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger subscriptions_guard before insert or update on public.subscriptions
  for each row execute function private.tg_subscriptions_guard();

-- El espacio cubierto debe ser el dueño de la cuenta o uno vinculado a ella.
create function private.tg_subscriptions_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is not null and not exists (
    select 1 from public.billing_accounts a where a.id = new.billing_account_id and a.organization_id = new.workspace_id
    union all
    select 1 from public.billing_account_workspaces w where w.billing_account_id = new.billing_account_id and w.workspace_id = new.workspace_id
  ) then
    raise exception using errcode = 'P0001', message = 'subscription_workspace_mismatch';
  end if;
  return new;
end;
$$;

create trigger subscriptions_tenant before insert on public.subscriptions
  for each row execute function private.tg_subscriptions_tenant();

-- Historial automático de cada cambio de estado (además de los eventos explícitos).
create function private.tg_subscriptions_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.subscription_events (subscription_id, event_type, source, from_status, to_status, processed_at)
    values (new.id, 'status_changed', 'system', old.status, new.status, now());
  end if;
  return null;
end;
$$;

create trigger subscriptions_history after update of status on public.subscriptions
  for each row execute function private.tg_subscriptions_history();

create trigger subscription_plans_updated_at before update on public.subscription_plans
  for each row execute function private.tg_set_updated_at();
create trigger billing_accounts_updated_at before update on public.billing_accounts
  for each row execute function private.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Funciones de autorización
-- -----------------------------------------------------------------------------
create function private.is_platform_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid()));
$$;

-- Cuentas de facturación que administra la cuenta actual (Administración del espacio dueño).
-- Para un futuro rol «responsable de facturación», agregarlo aquí.
create function private.billing_admin_account_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select a.id from public.billing_accounts a
  where a.organization_id in (select private.admin_org_ids());
$$;

-- -----------------------------------------------------------------------------
-- Entitlements del espacio (para verificaciones en el servidor)
-- -----------------------------------------------------------------------------
create function public.workspace_entitlements(p_workspace_id uuid)
returns table (status public.subscription_status, plan_code text, feature_code text, enabled boolean, usage_limit integer)
language sql stable security definer
set search_path = ''
as $$
  with current_sub as (
    select s.* from public.subscriptions s
    where (s.workspace_id = p_workspace_id
           or (s.workspace_id is null and s.billing_account_id = (
             select w.billing_account_id from public.billing_account_workspaces w where w.workspace_id = p_workspace_id)))
      and s.status not in ('canceled', 'expired')
    order by s.workspace_id nulls last
    limit 1
  )
  select c.status, p.code, e.feature_code, e.enabled, e.usage_limit
  from current_sub c
  join public.subscription_plans p on p.id = c.plan_id
  join public.plan_entitlements e on e.plan_id = p.id
  where private.is_member_of(p_workspace_id) or private.is_platform_staff();
$$;

-- Verificación de límites en la base (preparada; activa con billing_settings.enforce_limits).
create function private.tg_professionals_plan_limit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_enforce boolean;
  v_limit integer;
  v_status public.subscription_status;
  v_active integer;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then
    return new;
  end if;
  select enforce_limits into v_enforce from public.billing_settings where id;
  if not coalesce(v_enforce, false) then
    return new;
  end if;
  select s.status, e.usage_limit into v_status, v_limit
  from public.subscriptions s
  join public.plan_entitlements e on e.plan_id = s.plan_id and e.feature_code = 'professionals.max' and e.enabled
  where s.workspace_id = new.organization_id and s.status not in ('canceled', 'expired')
  limit 1;
  if v_status is null then
    return new; -- Espacio sin suscripción: la política comercial la decide la aplicación.
  end if;
  if v_status in ('unpaid', 'incomplete') then
    raise exception using errcode = 'P0001', message = 'subscription_read_only';
  end if;
  if v_limit is not null then
    select count(*) into v_active from public.professionals p
    where p.organization_id = new.organization_id and p.active and p.id <> new.id;
    if v_active >= v_limit then
      raise exception using errcode = 'P0001', message = 'plan_limit_reached',
        detail = format('El plan permite %s profesionales activos.', v_limit);
    end if;
  end if;
  return new;
end;
$$;

create trigger professionals_plan_limit before insert or update of active on public.professionals
  for each row execute function private.tg_professionals_plan_limit();

-- -----------------------------------------------------------------------------
-- RLS: lectura por tenant; ninguna escritura desde la aplicación.
-- -----------------------------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.billing_settings enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_account_workspaces enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.subscription_change_requests enable row level security;
alter table public.billing_payment_methods enable row level security;
alter table public.billing_notifications enable row level security;
alter table public.billing_audit_log enable row level security;

create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Precios públicos (página /precios sin sesión): solo planes activos.
create policy billing_settings_public on public.billing_settings for select to anon, authenticated using (true);
create policy subscription_plans_public on public.subscription_plans for select to anon using (is_active);
create policy subscription_plans_member on public.subscription_plans for select to authenticated
  using (is_active or (select private.is_platform_staff()));
create policy plan_entitlements_public on public.plan_entitlements for select to anon
  using (exists (select 1 from public.subscription_plans p where p.id = plan_id and p.is_active));
create policy plan_entitlements_member on public.plan_entitlements for select to authenticated
  using (exists (select 1 from public.subscription_plans p where p.id = plan_id and (p.is_active or (select private.is_platform_staff()))));

create policy billing_accounts_select on public.billing_accounts for select to authenticated
  using (id in (select private.billing_admin_account_ids()) or (select private.is_platform_staff()));
create policy billing_account_workspaces_select on public.billing_account_workspaces for select to authenticated
  using (billing_account_id in (select private.billing_admin_account_ids()) or workspace_id in (select private.admin_org_ids()) or (select private.is_platform_staff()));
-- Cualquier miembro conoce el estado del plan de su espacio (para mostrar restricciones).
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (
    workspace_id in (select private.member_org_ids())
    or billing_account_id in (select private.billing_admin_account_ids())
    or (select private.is_platform_staff())
  );
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.billing_account_id in (select private.billing_admin_account_ids()))
         or (select private.is_platform_staff()));
create policy billing_invoices_select on public.billing_invoices for select to authenticated
  using (billing_account_id in (select private.billing_admin_account_ids()) or (select private.is_platform_staff()));
create policy payment_attempts_select on public.payment_attempts for select to authenticated
  using (exists (select 1 from public.billing_invoices i where i.id = invoice_id and i.billing_account_id in (select private.billing_admin_account_ids()))
         or (select private.is_platform_staff()));
create policy subscription_change_requests_select on public.subscription_change_requests for select to authenticated
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.billing_account_id in (select private.billing_admin_account_ids()))
         or (select private.is_platform_staff()));
create policy billing_payment_methods_select on public.billing_payment_methods for select to authenticated
  using (billing_account_id in (select private.billing_admin_account_ids()) or (select private.is_platform_staff()));
create policy billing_notifications_select on public.billing_notifications for select to authenticated
  using (billing_account_id in (select private.billing_admin_account_ids()) or (select private.is_platform_staff()));
create policy billing_audit_log_select on public.billing_audit_log for select to authenticated
  using ((select private.is_platform_staff()));

revoke all on
  public.platform_admins, public.billing_settings, public.subscription_plans, public.plan_entitlements,
  public.billing_accounts, public.billing_account_workspaces, public.subscriptions, public.subscription_events,
  public.billing_invoices, public.payment_attempts, public.subscription_change_requests,
  public.billing_payment_methods, public.billing_notifications, public.billing_audit_log
  from anon, authenticated;
grant select on public.billing_settings, public.subscription_plans, public.plan_entitlements to anon, authenticated;
grant select on
  public.platform_admins, public.billing_accounts, public.billing_account_workspaces, public.subscriptions,
  public.subscription_events, public.billing_invoices, public.payment_attempts, public.subscription_change_requests,
  public.billing_payment_methods, public.billing_notifications, public.billing_audit_log
  to authenticated;
-- Escritura: solo el procesador de eventos con credenciales de servicio.
grant all on
  public.platform_admins, public.billing_settings, public.subscription_plans, public.plan_entitlements,
  public.billing_accounts, public.billing_account_workspaces, public.subscriptions, public.subscription_events,
  public.billing_invoices, public.payment_attempts, public.subscription_change_requests,
  public.billing_payment_methods, public.billing_notifications, public.billing_audit_log
  to service_role;

revoke execute on function public.workspace_entitlements(uuid) from public, anon;
grant execute on function public.workspace_entitlements(uuid) to authenticated, service_role;
revoke execute on function private.subscription_transition_allowed(public.subscription_status, public.subscription_status), private.is_platform_staff(),
  private.billing_admin_account_ids(), private.tg_subscriptions_guard(), private.tg_subscriptions_tenant(), private.tg_subscriptions_history(),
  private.tg_professionals_plan_limit()
  from public, anon;
grant execute on function private.subscription_transition_allowed(public.subscription_status, public.subscription_status), private.is_platform_staff(),
  private.billing_admin_account_ids()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Catálogo inicial ILUSTRATIVO (se edita desde el panel de la plataforma)
-- -----------------------------------------------------------------------------
insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

insert into public.subscription_plans (code, name, description, monthly_price_cents, annual_price_cents, is_custom_pricing, badge, tier, display_order)
values
  ('esencial', 'Esencial', 'Para profesionales independientes.', 39900, 406980, false, null, 1, 10),
  ('profesional', 'Profesional', 'Para clínicas pequeñas.', 89900, 916980, false, 'Más popular', 2, 20),
  ('empresarial', 'Empresarial', 'Para clínicas y centros médicos grandes.', 199900, 2038980, false, null, 3, 30),
  ('corporativo', 'Corporativo', 'Para hospitales y grupos médicos.', null, null, true, null, 4, 40)
on conflict (code) do nothing;

insert into public.plan_entitlements (plan_id, feature_code, enabled, usage_limit)
select p.id, e.feature_code, true, e.usage_limit
from public.subscription_plans p
join (values
  ('esencial', 'professionals.max', 1), ('esencial', 'users.max', 2), ('esencial', 'workspaces.max', 1),
  ('profesional', 'professionals.max', 5), ('profesional', 'users.max', 10), ('profesional', 'workspaces.max', 1),
  ('empresarial', 'professionals.max', 20), ('empresarial', 'users.max', 50), ('empresarial', 'workspaces.max', 1),
  ('corporativo', 'professionals.max', null), ('corporativo', 'users.max', null), ('corporativo', 'workspaces.max', null)
) as e(plan_code, feature_code, usage_limit) on e.plan_code = p.code
on conflict (plan_id, feature_code) do nothing;

insert into public.plan_entitlements (plan_id, feature_code, enabled)
select p.id, f.feature_code, true
from public.subscription_plans p
cross join (values
  ('module.agenda'), ('module.patients'), ('module.services'), ('module.cash'), ('module.schedules'), ('activity.history'), ('reports.basic')
) as f(feature_code)
on conflict (plan_id, feature_code) do nothing;

insert into public.plan_entitlements (plan_id, feature_code, enabled)
select p.id, f.feature_code, true
from public.subscription_plans p
join (values
  ('profesional', 'reports.financial'), ('profesional', 'reminders.automatic'),
  ('empresarial', 'reports.financial'), ('empresarial', 'reports.advanced'), ('empresarial', 'admin.advanced'),
  ('empresarial', 'areas.multiple'), ('empresarial', 'reminders.automatic'), ('empresarial', 'automations'), ('empresarial', 'support.priority'),
  ('corporativo', 'reports.financial'), ('corporativo', 'reports.advanced'), ('corporativo', 'admin.advanced'),
  ('corporativo', 'areas.multiple'), ('corporativo', 'reminders.automatic'), ('corporativo', 'automations'), ('corporativo', 'support.priority'),
  ('corporativo', 'billing.central'), ('corporativo', 'admin.enterprise'), ('corporativo', 'api.access')
) as f(plan_code, feature_code) on f.plan_code = p.code
on conflict (plan_id, feature_code) do nothing;
