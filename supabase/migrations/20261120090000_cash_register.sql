-- =============================================================================
-- Wattalis · 0005 · Caja
-- Cobros, turnos de caja, movimientos de efectivo y corte. Reglas garantizadas
-- en PostgreSQL:
--   * Una sola caja por espacio: como máximo un turno abierto a la vez.
--   * Un cobro solo existe dentro de un turno abierto; los pagos suman exactamente
--     el total (sin saldos ni cobros parciales en esta versión).
--   * Los precios de los servicios los decide el servidor, no el navegador.
--   * Una cita no se cobra dos veces; un doble clic no duplica el cobro
--     (p_idempotency_key).
--   * Los cobros no se editan ni se borran: solo se cancelan con motivo, y solo
--     administración, mientras el turno siga abierto. Después del corte el turno
--     queda inmutable.
--   * El cliente no escribe en estas tablas: solo lee (Recepción y Administración)
--     y opera mediante las funciones de este archivo.
-- Moneda única: peso mexicano (MXN).
-- =============================================================================

create type public.payment_method as enum ('cash', 'card', 'transfer');
create type public.charge_status as enum ('paid', 'voided');
create type public.cash_movement_kind as enum ('in', 'out');

-- -----------------------------------------------------------------------------
-- Precio de lista de los servicios
-- -----------------------------------------------------------------------------
alter table public.services
  add column price numeric(12, 2) not null default 0 check (price >= 0 and price <= 9999999.99);
comment on column public.services.price is 'Precio de lista en MXN. El cobro siempre usa el precio vigente del servidor.';

grant insert (price) on public.services to authenticated;
grant update (price) on public.services to authenticated;

-- Las citas necesitan una llave (id, organization_id) para la llave foránea compuesta.
alter table public.appointments add constraint appointments_id_org_key unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- Turnos de caja
-- -----------------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_amount numeric(12, 2) not null check (opening_amount >= 0),
  opening_notes text check (char_length(opening_notes) <= 300),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  counted_cash numeric(12, 2) check (counted_cash >= 0),
  expected_cash numeric(12, 2),
  difference numeric(12, 2) generated always as (counted_cash - expected_cash) stored,
  closing_notes text check (char_length(closing_notes) <= 300),
  unique (id, organization_id),
  check (
    (closed_at is null and counted_cash is null and expected_cash is null)
    or (closed_at is not null and counted_cash is not null and expected_cash is not null)
  )
);
comment on table public.cash_sessions is 'Turno de caja: apertura con fondo, cobros y movimientos, y corte con conteo de efectivo.';
comment on column public.cash_sessions.counted_cash is 'Efectivo contado al cerrar. expected_cash se calcula en el servidor.';
create unique index cash_sessions_one_open_idx on public.cash_sessions (organization_id) where closed_at is null;
create index cash_sessions_org_idx on public.cash_sessions (organization_id, opened_at desc);

-- -----------------------------------------------------------------------------
-- Cobros, conceptos y pagos
-- -----------------------------------------------------------------------------
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null,
  folio integer not null check (folio > 0),
  contact_id uuid,
  appointment_id uuid,
  subtotal numeric(12, 2) not null check (subtotal > 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) not null check (total > 0),
  status public.charge_status not null default 'paid',
  notes text check (char_length(notes) <= 300),
  idempotency_key uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 200),
  unique (id, organization_id),
  unique (organization_id, folio),
  check (discount < subtotal and total = subtotal - discount),
  check ((status = 'voided') = (voided_at is not null) and (status = 'voided') = (void_reason is not null)),
  constraint charges_session_fk foreign key (session_id, organization_id)
    references public.cash_sessions (id, organization_id),
  constraint charges_contact_fk foreign key (contact_id, organization_id)
    references public.contacts (id, organization_id),
  constraint charges_appointment_fk foreign key (appointment_id, organization_id)
    references public.appointments (id, organization_id)
);
comment on table public.charges is 'Cobro registrado en un turno de caja. No se edita: se cancela con motivo.';
create unique index charges_idempotency_idx on public.charges (organization_id, idempotency_key)
  where idempotency_key is not null;
-- Una cita tiene como máximo un cobro vigente; si se cancela, puede volver a cobrarse.
create unique index charges_one_paid_per_appointment_idx on public.charges (appointment_id)
  where appointment_id is not null and status = 'paid';
create index charges_session_idx on public.charges (session_id, created_at desc);
create index charges_org_created_idx on public.charges (organization_id, created_at desc);
create index charges_contact_idx on public.charges (contact_id) where contact_id is not null;

create table public.charge_items (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  charge_id uuid not null,
  service_id uuid,
  description text not null check (char_length(btrim(description)) between 2 and 160),
  quantity integer not null check (quantity between 1 and 999),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  amount numeric(12, 2) not null,
  check (amount = quantity * unit_price),
  constraint charge_items_charge_fk foreign key (charge_id, organization_id)
    references public.charges (id, organization_id),
  constraint charge_items_service_fk foreign key (service_id, organization_id)
    references public.services (id, organization_id)
);
create index charge_items_charge_idx on public.charge_items (charge_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  charge_id uuid not null,
  session_id uuid not null,
  method public.payment_method not null,
  amount numeric(12, 2) not null check (amount > 0),
  reference text check (char_length(reference) <= 80),
  created_at timestamptz not null default now(),
  constraint payments_charge_fk foreign key (charge_id, organization_id)
    references public.charges (id, organization_id),
  constraint payments_session_fk foreign key (session_id, organization_id)
    references public.cash_sessions (id, organization_id)
);
create index payments_charge_idx on public.payments (charge_id);
create index payments_session_idx on public.payments (session_id, method);

-- -----------------------------------------------------------------------------
-- Entradas y salidas de efectivo durante el turno (gastos, retiros, cambio)
-- -----------------------------------------------------------------------------
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null,
  kind public.cash_movement_kind not null,
  amount numeric(12, 2) not null check (amount > 0),
  concept text not null check (char_length(btrim(concept)) between 3 and 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cash_movements_session_fk foreign key (session_id, organization_id)
    references public.cash_sessions (id, organization_id)
);
create index cash_movements_session_idx on public.cash_movements (session_id, created_at);

-- Folios consecutivos por espacio.
create table private.charge_counters (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_folio integer not null default 0
);

-- -----------------------------------------------------------------------------
-- RLS: lectura para Administración y Recepción. Los profesionales no ven la caja.
-- Ninguna política de escritura: todo cambio pasa por las funciones de abajo.
-- -----------------------------------------------------------------------------
alter table public.cash_sessions enable row level security;
alter table public.charges enable row level security;
alter table public.charge_items enable row level security;
alter table public.payments enable row level security;
alter table public.cash_movements enable row level security;

create policy cash_sessions_select on public.cash_sessions for select to authenticated
  using (organization_id in (select private.staff_org_ids()));
create policy charges_select on public.charges for select to authenticated
  using (organization_id in (select private.staff_org_ids()));
create policy charge_items_select on public.charge_items for select to authenticated
  using (organization_id in (select private.staff_org_ids()));
create policy payments_select on public.payments for select to authenticated
  using (organization_id in (select private.staff_org_ids()));
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (organization_id in (select private.staff_org_ids()));

revoke all on public.cash_sessions, public.charges, public.charge_items, public.payments, public.cash_movements
  from anon, authenticated;
grant select on public.cash_sessions, public.charges, public.charge_items, public.payments, public.cash_movements
  to authenticated;
revoke all on private.charge_counters from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Utilidades internas
-- -----------------------------------------------------------------------------
create function private.require_staff(p_organization_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_organization_id is null or p_organization_id not in (select private.staff_org_ids()) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
end;
$$;

create function private.next_charge_folio(p_organization_id uuid)
returns integer
language sql volatile security definer
set search_path = ''
as $$
  insert into private.charge_counters as c (organization_id, last_folio)
  values (p_organization_id, 1)
  on conflict (organization_id) do update set last_folio = c.last_folio + 1
  returning c.last_folio;
$$;

-- -----------------------------------------------------------------------------
-- Totales de un turno. SECURITY INVOKER: RLS decide quién puede verlos.
-- El efectivo esperado = fondo + cobros en efectivo vigentes + entradas - salidas.
-- El corte usa esta misma función, así que lo que se ve es lo que se compara.
-- -----------------------------------------------------------------------------
create function public.cash_session_totals(p_session_id uuid)
returns table (
  opening_amount numeric,
  cash_sales numeric,
  card_sales numeric,
  transfer_sales numeric,
  movements_in numeric,
  movements_out numeric,
  expected_cash numeric,
  charges_count integer,
  voided_count integer,
  voided_total numeric
)
language sql stable security invoker
set search_path = ''
as $$
  with agg as (
    select s.id, s.opening_amount,
      coalesce((select sum(p.amount) from public.payments p join public.charges c on c.id = p.charge_id
                where p.session_id = s.id and c.status = 'paid' and p.method = 'cash'), 0) as cash_sales,
      coalesce((select sum(p.amount) from public.payments p join public.charges c on c.id = p.charge_id
                where p.session_id = s.id and c.status = 'paid' and p.method = 'card'), 0) as card_sales,
      coalesce((select sum(p.amount) from public.payments p join public.charges c on c.id = p.charge_id
                where p.session_id = s.id and c.status = 'paid' and p.method = 'transfer'), 0) as transfer_sales,
      coalesce((select sum(m.amount) from public.cash_movements m where m.session_id = s.id and m.kind = 'in'), 0) as movements_in,
      coalesce((select sum(m.amount) from public.cash_movements m where m.session_id = s.id and m.kind = 'out'), 0) as movements_out,
      (select count(*)::integer from public.charges c where c.session_id = s.id and c.status = 'paid') as charges_count,
      (select count(*)::integer from public.charges c where c.session_id = s.id and c.status = 'voided') as voided_count,
      coalesce((select sum(c.total) from public.charges c where c.session_id = s.id and c.status = 'voided'), 0) as voided_total
    from public.cash_sessions s
    where s.id = p_session_id
  )
  select a.opening_amount, a.cash_sales, a.card_sales, a.transfer_sales, a.movements_in, a.movements_out,
         a.opening_amount + a.cash_sales + a.movements_in - a.movements_out,
         a.charges_count, a.voided_count, a.voided_total
  from agg a;
$$;

-- -----------------------------------------------------------------------------
-- Abrir turno
-- -----------------------------------------------------------------------------
create function public.open_cash_session(
  p_organization_id uuid,
  p_opening_amount numeric,
  p_notes text default null
)
returns public.cash_sessions
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
begin
  perform private.require_staff(p_organization_id);
  if p_opening_amount is null or p_opening_amount < 0 or p_opening_amount <> round(p_opening_amount, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;
  begin
    insert into public.cash_sessions (organization_id, opened_by, opening_amount, opening_notes)
    values (p_organization_id, (select auth.uid()), p_opening_amount, nullif(btrim(p_notes), ''))
    returning * into v_session;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'cash_session_already_open';
  end;
  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cobrar (atómico: cobro + conceptos + pagos, o nada)
--   p_items:    [{ "service_id": uuid|null, "description": text, "quantity": int, "unit_price": numeric }]
--               Con service_id se usa el nombre y el precio vigentes del servicio.
--   p_payments: [{ "method": "cash"|"card"|"transfer", "amount": numeric, "reference": text|null }]
--               Deben sumar exactamente el total. El cambio al cliente no se registra:
--               el pago en efectivo es lo que se queda en caja.
-- -----------------------------------------------------------------------------
create function public.create_charge(
  p_organization_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric default 0,
  p_contact_id uuid default null,
  p_appointment_id uuid default null,
  p_notes text default null,
  p_idempotency_key uuid default null
)
returns public.charges
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.cash_sessions;
  v_existing public.charges;
  v_appointment public.appointments;
  v_service public.services;
  v_charge public.charges;
  v_item jsonb;
  v_pay jsonb;
  v_description text;
  v_quantity integer;
  v_price numeric;
  v_subtotal numeric := 0;
  v_discount numeric := coalesce(p_discount, 0);
  v_total numeric;
  v_paid numeric := 0;
  v_contact uuid := p_contact_id;
  v_amount numeric;
begin
  perform private.require_staff(p_organization_id);

  if p_idempotency_key is not null then
    select * into v_existing from public.charges c
    where c.organization_id = p_organization_id and c.idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  -- Bloquea el turno: serializa cobros, folios, cancelaciones y el corte.
  select * into v_session from public.cash_sessions s
  where s.organization_id = p_organization_id and s.closed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'no_open_cash_session';
  end if;

  -- Dos pasos: PostgreSQL no garantiza el orden de evaluación dentro de un solo OR.
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_charge';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 or jsonb_array_length(p_payments) not between 1 and 10 then
    raise exception using errcode = 'P0001', message = 'invalid_charge';
  end if;
  if v_discount < 0 or v_discount <> round(v_discount, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;

  if p_appointment_id is not null then
    select * into v_appointment from public.appointments a
    where a.id = p_appointment_id and a.organization_id = p_organization_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'appointment_not_found';
    end if;
    if v_appointment.status = 'cancelled' then
      raise exception using errcode = 'P0001', message = 'appointment_not_chargeable';
    end if;
    if exists (select 1 from public.charges c where c.appointment_id = p_appointment_id and c.status = 'paid') then
      raise exception using errcode = 'P0001', message = 'appointment_already_charged';
    end if;
    v_contact := coalesce(v_contact, v_appointment.contact_id);
  end if;

  -- Conceptos: valida y suma. Los servicios del catálogo cobran su precio vigente.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity is null or v_quantity not between 1 and 999 then
      raise exception using errcode = 'P0001', message = 'invalid_charge';
    end if;
    if nullif(v_item ->> 'service_id', '') is not null then
      select * into v_service from public.services s
      where s.id = (v_item ->> 'service_id')::uuid and s.organization_id = p_organization_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'service_not_found';
      end if;
      v_description := v_service.name;
      v_price := v_service.price;
    else
      v_description := btrim(coalesce(v_item ->> 'description', ''));
      v_price := (v_item ->> 'unit_price')::numeric;
      if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
        raise exception using errcode = 'P0001', message = 'invalid_amount';
      end if;
    end if;
    v_subtotal := v_subtotal + v_quantity * v_price;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_subtotal <= 0 or v_discount >= v_subtotal or v_total <= 0 then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_amount := (v_pay ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
      raise exception using errcode = 'P0001', message = 'invalid_amount';
    end if;
    v_paid := v_paid + v_amount;
  end loop;
  if v_paid <> v_total then
    raise exception using errcode = 'P0001', message = 'payment_mismatch', detail = v_total::text;
  end if;

  insert into public.charges
    (organization_id, session_id, folio, contact_id, appointment_id, subtotal, discount, total, notes, idempotency_key, created_by)
  values
    (p_organization_id, v_session.id, private.next_charge_folio(p_organization_id), v_contact, p_appointment_id,
     v_subtotal, v_discount, v_total, nullif(btrim(p_notes), ''), p_idempotency_key, v_uid)
  returning * into v_charge;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if nullif(v_item ->> 'service_id', '') is not null then
      select * into v_service from public.services s where s.id = (v_item ->> 'service_id')::uuid;
      v_description := v_service.name;
      v_price := v_service.price;
    else
      v_description := btrim(v_item ->> 'description');
      v_price := (v_item ->> 'unit_price')::numeric;
    end if;
    insert into public.charge_items (organization_id, charge_id, service_id, description, quantity, unit_price, amount)
    values (p_organization_id, v_charge.id, nullif(v_item ->> 'service_id', '')::uuid, v_description, v_quantity, v_price, v_quantity * v_price);
  end loop;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    insert into public.payments (organization_id, charge_id, session_id, method, amount, reference)
    values (p_organization_id, v_charge.id, v_session.id, (v_pay ->> 'method')::public.payment_method,
            (v_pay ->> 'amount')::numeric, nullif(btrim(v_pay ->> 'reference'), ''));
  end loop;

  return v_charge;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cancelar un cobro (solo Administración, con motivo, y solo en turno abierto)
-- -----------------------------------------------------------------------------
create function public.void_charge(p_charge_id uuid, p_reason text)
returns public.charges
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_charge public.charges;
  v_session public.cash_sessions;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  select * into v_charge from public.charges c where c.id = p_charge_id;
  if not found or v_charge.organization_id not in (select private.staff_org_ids()) then
    raise exception using errcode = 'P0001', message = 'charge_not_found';
  end if;
  if v_charge.organization_id not in (select private.admin_org_ids()) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception using errcode = 'P0001', message = 'void_reason_required';
  end if;

  select * into v_session from public.cash_sessions s where s.id = v_charge.session_id for update;
  select * into v_charge from public.charges c where c.id = p_charge_id for update;
  if v_charge.status <> 'paid' then
    raise exception using errcode = 'P0001', message = 'charge_already_voided';
  end if;
  if v_session.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'cash_session_closed';
  end if;

  -- Si el efectivo cobrado ya salió de la caja, no se puede cancelar sin dejarla en negativo.
  if (select t.expected_cash from public.cash_session_totals(v_session.id) t)
     - coalesce((select sum(p.amount) from public.payments p where p.charge_id = v_charge.id and p.method = 'cash'), 0) < 0 then
    raise exception using errcode = 'P0001', message = 'insufficient_cash';
  end if;

  update public.charges
  set status = 'voided', voided_by = v_uid, voided_at = now(), void_reason = v_reason
  where id = p_charge_id
  returning * into v_charge;
  return v_charge;
end;
$$;

-- -----------------------------------------------------------------------------
-- Entradas y salidas de efectivo
-- -----------------------------------------------------------------------------
create function public.add_cash_movement(
  p_organization_id uuid,
  p_kind public.cash_movement_kind,
  p_amount numeric,
  p_concept text
)
returns public.cash_movements
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
  v_movement public.cash_movements;
  v_concept text := btrim(coalesce(p_concept, ''));
begin
  perform private.require_staff(p_organization_id);
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;
  if char_length(v_concept) < 3 or char_length(v_concept) > 160 then
    raise exception using errcode = 'P0001', message = 'concept_required';
  end if;

  select * into v_session from public.cash_sessions s
  where s.organization_id = p_organization_id and s.closed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'no_open_cash_session';
  end if;

  if p_kind = 'out' and (select t.expected_cash from public.cash_session_totals(v_session.id) t) < p_amount then
    raise exception using errcode = 'P0001', message = 'insufficient_cash';
  end if;

  insert into public.cash_movements (organization_id, session_id, kind, amount, concept, created_by)
  values (p_organization_id, v_session.id, p_kind, p_amount, v_concept, (select auth.uid()))
  returning * into v_movement;
  return v_movement;
end;
$$;

-- -----------------------------------------------------------------------------
-- Corte: cierra el turno comparando el efectivo contado contra el esperado.
-- Si hay diferencia, el motivo es obligatorio.
-- -----------------------------------------------------------------------------
create function public.close_cash_session(
  p_session_id uuid,
  p_counted_amount numeric,
  p_notes text default null
)
returns public.cash_sessions
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
  v_expected numeric;
  v_notes text := nullif(btrim(p_notes), '');
begin
  select * into v_session from public.cash_sessions s where s.id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'cash_session_not_found';
  end if;
  perform private.require_staff(v_session.organization_id);
  if p_counted_amount is null or p_counted_amount < 0 or p_counted_amount <> round(p_counted_amount, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;

  select * into v_session from public.cash_sessions s where s.id = p_session_id for update;
  if v_session.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'cash_session_closed';
  end if;

  select t.expected_cash into v_expected from public.cash_session_totals(p_session_id) t;
  if p_counted_amount <> v_expected and v_notes is null then
    raise exception using errcode = 'P0001', message = 'difference_needs_note', detail = v_expected::text;
  end if;

  update public.cash_sessions
  set closed_at = now(), closed_by = (select auth.uid()), counted_cash = p_counted_amount,
      expected_cash = v_expected, closing_notes = v_notes
  where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilegios de ejecución (nada para anon; las internas no se exponen)
-- -----------------------------------------------------------------------------
revoke execute on function
  public.cash_session_totals(uuid),
  public.open_cash_session(uuid, numeric, text),
  public.create_charge(uuid, jsonb, jsonb, numeric, uuid, uuid, text, uuid),
  public.void_charge(uuid, text),
  public.add_cash_movement(uuid, public.cash_movement_kind, numeric, text),
  public.close_cash_session(uuid, numeric, text)
from public, anon;
grant execute on function
  public.cash_session_totals(uuid),
  public.open_cash_session(uuid, numeric, text),
  public.create_charge(uuid, jsonb, jsonb, numeric, uuid, uuid, text, uuid),
  public.void_charge(uuid, text),
  public.add_cash_movement(uuid, public.cash_movement_kind, numeric, text),
  public.close_cash_session(uuid, numeric, text)
to authenticated, service_role;

revoke execute on function private.require_staff(uuid), private.next_charge_folio(uuid) from public, anon, authenticated;
grant execute on function private.require_staff(uuid), private.next_charge_folio(uuid) to service_role;
