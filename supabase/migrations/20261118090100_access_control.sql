-- =============================================================================
-- Wattalis · 0002 · Control de acceso
-- Funciones auxiliares, Row Level Security, privilegios por columna y reglas de
-- integridad de membresías. La autorización real vive aquí: el frontend solo
-- navega. Ningún organization_id, rol o professional_id del cliente se da por
-- bueno sin pasar por estas políticas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares (SECURITY DEFINER para evitar recursión de RLS).
-- Devuelven conjuntos para que las políticas se evalúen una sola vez por consulta.
-- -----------------------------------------------------------------------------
create function private.member_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.organization_id from public.memberships m where m.user_id = (select auth.uid());
$$;

create function private.staff_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.organization_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.role in ('admin', 'reception');
$$;

create function private.admin_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.organization_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = 'admin';
$$;

-- Perfiles profesionales vinculados a la cuenta actual. La llave foránea
-- professionals_member_fk garantiza que el vínculo solo existe mientras haya membresía.
create function private.own_professional_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id from public.professionals p where p.user_id = (select auth.uid());
$$;

-- Contactos vinculados a citas de los perfiles profesionales de la cuenta actual.
create function private.own_contact_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct a.contact_id
  from public.appointments a
  join public.professionals p on p.id = a.professional_id
  where p.user_id = (select auth.uid());
$$;

create function private.co_member_user_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct m2.user_id
  from public.memberships m1
  join public.memberships m2 on m2.organization_id = m1.organization_id
  where m1.user_id = (select auth.uid());
$$;

create function private.is_admin_of(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

create function private.is_staff_of(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
      and m.role in ('admin', 'reception')
  );
$$;

create function private.is_member_of(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
  );
$$;

-- -----------------------------------------------------------------------------
-- Perfiles: se crean automáticamente al registrarse.
-- -----------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120),
    lower(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create function private.handle_user_email_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Espacios de trabajo
-- -----------------------------------------------------------------------------
create function private.tg_organizations_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone',
      detail = 'La zona horaria no es válida.';
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_before_write before insert or update on public.organizations
  for each row execute function private.tg_organizations_before_write();

-- -----------------------------------------------------------------------------
-- Membresías: nunca dejar un espacio sin administrador.
-- Se bloquea la fila del espacio para serializar cambios concurrentes de rol.
-- -----------------------------------------------------------------------------
create function private.tg_memberships_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_other_admins integer;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
      raise exception using errcode = 'P0001', message = 'membership_immutable';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    if old.role = 'admin' and new.role <> 'admin' then
      perform 1 from public.organizations o where o.id = old.organization_id for no key update;
      select count(*) into v_other_admins from public.memberships m
      where m.organization_id = old.organization_id and m.role = 'admin' and m.id <> old.id;
      if v_other_admins = 0 then
        raise exception using errcode = 'P0001', message = 'last_admin',
          detail = 'El espacio debe conservar al menos un administrador.';
      end if;
    end if;
    return new;
  end if;

  -- DELETE
  if old.role = 'admin' then
    perform 1 from public.organizations o where o.id = old.organization_id for no key update;
    if not found then
      return old; -- el espacio completo se está eliminando
    end if;
    select count(*) into v_other_admins from public.memberships m
    where m.organization_id = old.organization_id and m.role = 'admin' and m.id <> old.id;
    if v_other_admins = 0 then
      raise exception using errcode = 'P0001', message = 'last_admin',
        detail = 'El espacio debe conservar al menos un administrador.';
    end if;
  end if;
  return old;
end;
$$;

create trigger memberships_guard before update or delete on public.memberships
  for each row execute function private.tg_memberships_guard();

-- -----------------------------------------------------------------------------
-- Profesionales
-- -----------------------------------------------------------------------------
create function private.tg_professionals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_name := btrim(new.display_name);
  new.specialty := nullif(btrim(new.specialty), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception using errcode = 'P0001', message = 'organization_immutable';
    end if;
    new.created_at := old.created_at;
    if new.active and not old.active then
      new.deactivated_at := null;
    elsif not new.active and old.active then
      new.deactivated_at := now();
    end if;
  elsif not new.active then
    new.deactivated_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger professionals_before_write before insert or update on public.professionals
  for each row execute function private.tg_professionals_before_write();

-- -----------------------------------------------------------------------------
-- Contactos
-- -----------------------------------------------------------------------------
create function private.tg_contacts_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  new.phone := nullif(btrim(new.phone), '');
  new.email := nullif(lower(btrim(new.email)), '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception using errcode = 'P0001', message = 'organization_immutable';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger contacts_before_write before insert or update on public.contacts
  for each row execute function private.tg_contacts_before_write();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.professional_types enable row level security;
alter table public.professionals enable row level security;
alter table public.services enable row level security;
alter table public.professional_services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.time_off enable row level security;
alter table public.contacts enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;

-- Perfiles: la propia cuenta y compañeros de algún espacio en común.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or id in (select private.co_member_user_ids()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Espacios: los miembros los ven; solo administración los modifica.
-- La creación ocurre exclusivamente en public.create_organization().
create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.member_org_ids()));
create policy organizations_update on public.organizations for update to authenticated
  using (id in (select private.admin_org_ids())) with check (id in (select private.admin_org_ids()));

-- Membresías: cada cuenta ve las suyas; administración ve y gestiona las de su espacio.
-- Las altas ocurren solo en create_organization() y accept_invitation().
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or organization_id in (select private.admin_org_ids()));
create policy memberships_update on public.memberships for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));
create policy memberships_delete on public.memberships for delete to authenticated
  using (organization_id in (select private.admin_org_ids()) or user_id = (select auth.uid()));

-- Invitaciones: solo administración. La creación ocurre en create_invitation().
create policy invitations_select on public.invitations for select to authenticated
  using (organization_id in (select private.admin_org_ids()));
create policy invitations_update on public.invitations for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));
create policy invitations_delete on public.invitations for delete to authenticated
  using (organization_id in (select private.admin_org_ids()));

-- Catálogo de tipos: lectura para cualquier cuenta.
create policy professional_types_select on public.professional_types for select to authenticated
  using (true);

-- Profesionales: administración y recepción ven todos los de su espacio;
-- el rol Profesional solo su propio perfil.
create policy professionals_select on public.professionals for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or id in (select private.own_professional_ids())
  );
create policy professionals_insert on public.professionals for insert to authenticated
  with check (organization_id in (select private.admin_org_ids()));
create policy professionals_update on public.professionals for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));

-- Servicios: cualquier miembro los consulta; administración los gestiona.
create policy services_select on public.services for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy services_insert on public.services for insert to authenticated
  with check (organization_id in (select private.admin_org_ids()));
create policy services_update on public.services for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));

create policy professional_services_select on public.professional_services for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy professional_services_insert on public.professional_services for insert to authenticated
  with check (organization_id in (select private.admin_org_ids()));
create policy professional_services_delete on public.professional_services for delete to authenticated
  using (organization_id in (select private.admin_org_ids()));

-- Horarios semanales y bloqueos: visibles para quien puede agendar con ese profesional.
create policy availability_rules_select on public.availability_rules for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy availability_rules_insert on public.availability_rules for insert to authenticated
  with check (organization_id in (select private.admin_org_ids()));
create policy availability_rules_update on public.availability_rules for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));
create policy availability_rules_delete on public.availability_rules for delete to authenticated
  using (organization_id in (select private.admin_org_ids()));

create policy time_off_select on public.time_off for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy time_off_insert on public.time_off for insert to authenticated
  with check (organization_id in (select private.admin_org_ids()));
create policy time_off_update on public.time_off for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));
create policy time_off_delete on public.time_off for delete to authenticated
  using (organization_id in (select private.admin_org_ids()));

-- Contactos: administración y recepción ven todos; el rol Profesional ve los
-- vinculados a sus citas y los que él mismo registró.
create policy contacts_select on public.contacts for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or (created_by = (select auth.uid()) and organization_id in (select private.member_org_ids()))
    or id in (select private.own_contact_ids())
  );
create policy contacts_insert on public.contacts for insert to authenticated
  with check (organization_id in (select private.member_org_ids()));
create policy contacts_update on public.contacts for update to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or (created_by = (select auth.uid()) and organization_id in (select private.member_org_ids()))
  )
  with check (
    organization_id in (select private.staff_org_ids())
    or (created_by = (select auth.uid()) and organization_id in (select private.member_org_ids()))
  );
create policy contacts_delete on public.contacts for delete to authenticated
  using (organization_id in (select private.admin_org_ids()));

-- Citas: administración y recepción gestionan las de todo su espacio;
-- el rol Profesional solo las de su propio perfil. No hay borrado: se cancela.
create policy appointments_select on public.appointments for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy appointments_insert on public.appointments for insert to authenticated
  with check (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy appointments_update on public.appointments for update to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  )
  with check (
    organization_id in (select private.staff_org_ids())
    or professional_id in (select private.own_professional_ids())
  );

-- Historial: visible si la cita es visible. Solo lo escriben los triggers.
create policy appointment_events_select on public.appointment_events for select to authenticated
  using (
    organization_id in (select private.staff_org_ids())
    or appointment_id in (
      select a.id from public.appointments a
      where a.professional_id in (select private.own_professional_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- Privilegios. Supabase concede ALL por omisión a anon/authenticated; aquí se
-- reduce a lo mínimo y se limitan las columnas que puede escribir el cliente.
-- -----------------------------------------------------------------------------
revoke all on
  public.profiles, public.organizations, public.memberships, public.invitations,
  public.professional_types, public.professionals, public.services, public.professional_services,
  public.availability_rules, public.time_off, public.contacts, public.appointments,
  public.appointment_events
from anon, authenticated;

grant select on
  public.profiles, public.organizations, public.memberships, public.invitations,
  public.professional_types, public.professionals, public.services, public.professional_services,
  public.availability_rules, public.time_off, public.contacts, public.appointments,
  public.appointment_events
to authenticated;

grant update (full_name) on public.profiles to authenticated;
grant update (name, kind, timezone, slot_interval_minutes) on public.organizations to authenticated;
grant update (role) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
grant delete on public.invitations to authenticated;

grant insert (organization_id, user_id, display_name, professional_type, specialty, color, email, phone, active)
  on public.professionals to authenticated;
grant update (user_id, display_name, professional_type, specialty, color, email, phone, active)
  on public.professionals to authenticated;

grant insert (organization_id, name, duration_minutes, description, active) on public.services to authenticated;
grant update (name, duration_minutes, description, active) on public.services to authenticated;

grant insert (organization_id, professional_id, service_id) on public.professional_services to authenticated;
grant delete on public.professional_services to authenticated;

grant insert (organization_id, professional_id, weekday, start_time, end_time) on public.availability_rules to authenticated;
grant update (weekday, start_time, end_time) on public.availability_rules to authenticated;
grant delete on public.availability_rules to authenticated;

grant insert (organization_id, professional_id, starts_at, ends_at, kind, note) on public.time_off to authenticated;
grant update (starts_at, ends_at, kind, note) on public.time_off to authenticated;
grant delete on public.time_off to authenticated;

grant insert (organization_id, full_name, phone, email) on public.contacts to authenticated;
grant update (full_name, phone, email) on public.contacts to authenticated;
grant delete on public.contacts to authenticated;

grant insert (organization_id, professional_id, service_id, contact_id, pet_name, starts_at, ends_at, status, notes, idempotency_key)
  on public.appointments to authenticated;
grant update (professional_id, starts_at, status, notes, pet_name, cancellation_reason)
  on public.appointments to authenticated;
