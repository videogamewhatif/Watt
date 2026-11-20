-- =============================================================================
-- Wattalis · 0001 · Fundamentos
-- Extensiones, tipos y tablas. Toda entidad que pertenece a un espacio de trabajo
-- lleva organization_id, y las relaciones entre entidades usan llaves foráneas
-- compuestas (id, organization_id) para que la base rechace mezclas entre espacios.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
comment on schema private is 'Funciones internas de Wattalis. No se expone por la API de datos.';
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'reception', 'professional');
create type public.organization_kind as enum ('hospital', 'clinic', 'independent');
create type public.appointment_status as enum ('pending', 'confirmed', 'attended', 'cancelled', 'no_show');
create type public.time_off_kind as enum ('vacation', 'meal', 'absence', 'other');
create type public.appointment_event_type as enum ('created', 'status_changed', 'rescheduled', 'details_updated');

-- -----------------------------------------------------------------------------
-- Utilidades genéricas
-- -----------------------------------------------------------------------------
create function private.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.tg_keep_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception using errcode = 'P0001', message = 'organization_immutable',
      detail = 'Un registro no puede moverse a otro espacio de trabajo.';
  end if;
  return new;
end;
$$;

-- Normaliza texto para búsquedas sin acentos ni mayúsculas.
create function private.unaccent_lower(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(translate(coalesce(p_value, ''),
    'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
    'aaaaeeeeiiiioooouuuunaaaaeeeeiiiioooouuuun'));
$$;

create function private.phone_digits(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), '');
$$;

-- -----------------------------------------------------------------------------
-- Cuentas
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Perfil de cuenta (persona que inicia sesión).';

-- -----------------------------------------------------------------------------
-- Espacios de trabajo y membresías
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind public.organization_kind not null default 'clinic',
  timezone text not null default 'America/Mexico_City',
  slot_interval_minutes smallint not null default 15
    check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organizations is 'Espacio de trabajo: unidad de aislamiento (hospital, clínica o consultorio).';
comment on column public.organizations.timezone is 'Zona horaria IANA del espacio. Los horarios semanales son horas locales de esta zona.';

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
comment on table public.memberships is 'Relación cuenta–espacio con el rol que la cuenta tiene en ese espacio.';
create index memberships_user_idx on public.memberships (user_id);

-- -----------------------------------------------------------------------------
-- Profesionales y catálogo de tipos
-- -----------------------------------------------------------------------------
create table public.professional_types (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  label text not null,
  sort_order smallint not null default 100,
  uses_pet_name boolean not null default false,
  active boolean not null default true
);
comment on table public.professional_types is 'Catálogo ampliable de tipos de profesional.';

insert into public.professional_types (code, label, sort_order, uses_pet_name) values
  ('medico', 'Médico', 10, false),
  ('dentista', 'Dentista', 20, false),
  ('nutriologo', 'Nutriólogo', 30, false),
  ('veterinario', 'Veterinario', 40, true),
  ('otro', 'Otro', 90, false);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  professional_type text not null default 'medico' references public.professional_types (code),
  specialty text check (char_length(specialty) <= 120),
  color text not null default '#0f766e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or char_length(phone) between 7 and 30),
  active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  -- La cuenta vinculada debe ser miembro del MISMO espacio.
  constraint professionals_member_fk foreign key (organization_id, user_id)
    references public.memberships (organization_id, user_id) on delete set null (user_id)
);
comment on table public.professionals is 'Persona cuya agenda se administra. Puede existir sin cuenta de acceso.';
create unique index professionals_one_per_user_idx on public.professionals (organization_id, user_id)
  where user_id is not null;
create index professionals_user_idx on public.professionals (user_id) where user_id is not null;
create index professionals_org_idx on public.professionals (organization_id, active);

-- -----------------------------------------------------------------------------
-- Servicios
-- -----------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  description text check (char_length(description) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index services_org_idx on public.services (organization_id, active);

create table public.professional_services (
  organization_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (professional_id, service_id),
  constraint professional_services_professional_fk foreign key (professional_id, organization_id)
    references public.professionals (id, organization_id) on delete cascade,
  constraint professional_services_service_fk foreign key (service_id, organization_id)
    references public.services (id, organization_id) on delete cascade
);
create index professional_services_service_idx on public.professional_services (service_id);
create index professional_services_org_idx on public.professional_services (organization_id);

-- -----------------------------------------------------------------------------
-- Invitaciones (enlace de un solo uso, con vencimiento y correo destinatario)
-- -----------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  professional_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint invitations_professional_fk foreign key (professional_id, organization_id)
    references public.professionals (id, organization_id) on delete set null (professional_id)
);
comment on column public.invitations.token_hash is 'SHA-256 del token. El token en claro solo se entrega una vez al crear la invitación.';
create index invitations_org_idx on public.invitations (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Horario semanal (horas locales del espacio). Un día admite varios bloques.
-- -----------------------------------------------------------------------------
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = lunes … 7 = domingo
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  constraint availability_rules_professional_fk foreign key (professional_id, organization_id)
    references public.professionals (id, organization_id) on delete cascade,
  constraint availability_rules_no_overlap exclude using gist (
    professional_id with =,
    weekday with =,
    tsrange('2000-01-03'::date + start_time, '2000-01-03'::date + end_time, '[)') with &&
  )
);
create index availability_rules_org_idx on public.availability_rules (organization_id);

-- -----------------------------------------------------------------------------
-- Bloqueos puntuales (vacaciones, comida, ausencia)
-- -----------------------------------------------------------------------------
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind public.time_off_kind not null default 'other',
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint time_off_professional_fk foreign key (professional_id, organization_id)
    references public.professionals (id, organization_id) on delete cascade
);
create index time_off_range_idx on public.time_off using gist (professional_id, tstzrange(starts_at, ends_at, '[)'));
create index time_off_org_idx on public.time_off (organization_id, starts_at);

-- -----------------------------------------------------------------------------
-- Pacientes o contactos (datos administrativos mínimos; sin información clínica)
-- -----------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone text check (phone is null or char_length(phone) between 7 and 30),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  search_name text generated always as (private.unaccent_lower(full_name)) stored,
  phone_digits text generated always as (private.phone_digits(phone)) stored,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  unique (id, organization_id)
);
comment on table public.contacts is 'Paciente o contacto (en veterinaria, el tutor). Exige nombre y al menos un medio de contacto.';
create index contacts_org_name_trgm_idx on public.contacts using gin (search_name extensions.gin_trgm_ops);
create index contacts_org_name_idx on public.contacts (organization_id, search_name);
create index contacts_org_phone_idx on public.contacts (organization_id, right(phone_digits, 10));
create index contacts_org_email_idx on public.contacts (organization_id, lower(email));
create index contacts_created_by_idx on public.contacts (created_by);

-- -----------------------------------------------------------------------------
-- Citas
-- Los instantes se guardan con zona horaria. ends_at se calcula en el servidor y
-- se conserva aunque después cambie la duración del servicio.
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  professional_id uuid not null,
  service_id uuid not null,
  contact_id uuid not null,
  pet_name text check (char_length(btrim(pet_name)) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'pending',
  notes text check (char_length(notes) <= 500),
  cancellation_reason text check (char_length(cancellation_reason) <= 200),
  idempotency_key uuid,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointments_professional_fk foreign key (professional_id, organization_id)
    references public.professionals (id, organization_id),
  constraint appointments_service_fk foreign key (service_id, organization_id)
    references public.services (id, organization_id),
  constraint appointments_contact_fk foreign key (contact_id, organization_id)
    references public.contacts (id, organization_id),
  -- Garantía final: dos citas vigentes del mismo profesional nunca se traslapan.
  -- Intervalos [inicio, fin): 10:00–10:30 permite otra a las 10:30.
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);
create unique index appointments_idempotency_idx on public.appointments (organization_id, idempotency_key)
  where idempotency_key is not null;
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_professional_start_idx on public.appointments (professional_id, starts_at);
create index appointments_contact_idx on public.appointments (contact_id, starts_at desc);
create index appointments_service_idx on public.appointments (service_id);

-- -----------------------------------------------------------------------------
-- Historial de cambios de cita (quién, cuándo, qué estado u horario cambió).
-- No guarda datos del paciente.
-- -----------------------------------------------------------------------------
create table public.appointment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  event_type public.appointment_event_type not null,
  actor_id uuid references auth.users (id) on delete set null,
  from_status public.appointment_status,
  to_status public.appointment_status,
  from_starts_at timestamptz,
  from_ends_at timestamptz,
  to_starts_at timestamptz,
  to_ends_at timestamptz,
  from_professional_id uuid,
  to_professional_id uuid,
  created_at timestamptz not null default now()
);
create index appointment_events_appointment_idx on public.appointment_events (appointment_id, created_at);
create index appointment_events_org_idx on public.appointment_events (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Triggers genéricos
-- -----------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.tg_set_updated_at();

create trigger services_updated_at before update on public.services
  for each row execute function private.tg_set_updated_at();
create trigger services_keep_org before update on public.services
  for each row execute function private.tg_keep_organization();

create trigger professional_services_keep_org before update on public.professional_services
  for each row execute function private.tg_keep_organization();

create trigger availability_rules_keep_org before update on public.availability_rules
  for each row execute function private.tg_keep_organization();

create trigger invitations_keep_org before update on public.invitations
  for each row execute function private.tg_keep_organization();
