-- =============================================================================
-- Wattalis se enfoca en salud humana: se retira todo lo veterinario.
--   · Tipo de profesional 'veterinario' (los que lo usaran pasan a 'otro').
--   · Nombre de mascota en las citas (appointments.pet_name) y la bandera
--     professional_types.uses_pet_name.
-- Las funciones que mencionaban la mascota se redefinen sin ella.
-- =============================================================================

-- Tipo de profesional ----------------------------------------------------------
update public.professionals set professional_type = 'otro' where professional_type = 'veterinario';
delete from public.professional_types where code = 'veterinario';

-- Validación y historial de citas ---------------------------------------------
create or replace function private.tg_appointments_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_staff boolean;
  v_professional public.professionals;
  v_service public.services;
  v_check_slot boolean := false;
  v_problem text;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception using errcode = 'P0001', message = 'organization_immutable';
    end if;
    if new.contact_id <> old.contact_id or new.service_id <> old.service_id then
      raise exception using errcode = 'P0001', message = 'appointment_field_immutable',
        detail = 'Para cambiar paciente o servicio cancela la cita y crea una nueva.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.idempotency_key := old.idempotency_key;
  end if;

  -- Autorización explícita antes de consultar nada (evita filtrar disponibilidad
  -- de otros espacios a través de mensajes de error).
  if v_uid is not null then
    v_is_staff := new.organization_id in (select private.staff_org_ids());
    if not v_is_staff and not exists (
      select 1 from public.professionals p
      where p.id = new.professional_id and p.user_id = v_uid and p.organization_id = new.organization_id
    ) then
      raise exception using errcode = '42501', message = 'forbidden';
    end if;
  else
    v_is_staff := true; -- service_role o procesos internos (seed)
  end if;

  v_professional := private.lock_professional(new.professional_id);
  if v_professional.id is null or v_professional.organization_id <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'professional_not_found';
  end if;

  if tg_op = 'INSERT' then
    select * into v_service from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'service_not_found';
    end if;

    new.created_by := coalesce(v_uid, new.created_by);
    new.updated_by := new.created_by;
    new.created_at := now();
    new.updated_at := now();
    new.status_changed_at := now();
    new.notes := nullif(btrim(new.notes), '');
    -- La hora final siempre se calcula con la duración del servicio.
    new.ends_at := new.starts_at + make_interval(mins => v_service.duration_minutes);

    if v_uid is not null then
      if new.status not in ('pending', 'confirmed') then
        raise exception using errcode = 'P0001', message = 'invalid_initial_status';
      end if;
      if new.starts_at <= now() then
        raise exception using errcode = 'P0001', message = 'appointment_in_past';
      end if;
      -- El rol Profesional solo puede usar contactos a los que ya tiene acceso.
      if not v_is_staff and not exists (
        select 1 from public.contacts c
        where c.id = new.contact_id and c.organization_id = new.organization_id
          and (c.created_by = v_uid or c.id in (select private.own_contact_ids()))
      ) then
        raise exception using errcode = '42501', message = 'contact_not_accessible';
      end if;
    end if;
    v_check_slot := new.status in ('pending', 'confirmed');
  else
    new.updated_by := coalesce(v_uid, old.updated_by);
    new.updated_at := now();
    new.notes := nullif(btrim(new.notes), '');

    -- Reprogramar conserva la duración propia de la cita.
    if new.starts_at is distinct from old.starts_at then
      new.ends_at := new.starts_at + (old.ends_at - old.starts_at);
    else
      new.ends_at := old.ends_at;
    end if;

    if new.starts_at is distinct from old.starts_at or new.professional_id is distinct from old.professional_id then
      if old.status not in ('pending', 'confirmed') or new.status not in ('pending', 'confirmed') then
        raise exception using errcode = 'P0001', message = 'appointment_closed',
          detail = 'Solo se pueden reprogramar citas pendientes o confirmadas.';
      end if;
      if v_uid is not null and new.starts_at <= now() then
        raise exception using errcode = 'P0001', message = 'appointment_in_past';
      end if;
      v_check_slot := true;
    end if;

    if new.status is distinct from old.status then
      perform private.assert_status_transition(old.status, new.status, new.starts_at);
      new.status_changed_at := now();
    end if;
    if new.status <> 'cancelled' then
      new.cancellation_reason := null;
    end if;
  end if;

  if v_check_slot then
    if not v_professional.active then
      raise exception using errcode = 'P0001', message = 'professional_inactive';
    end if;
    select * into v_service from public.services s where s.id = new.service_id;
    if not v_service.active then
      raise exception using errcode = 'P0001', message = 'service_inactive';
    end if;
    if not exists (
      select 1 from public.professional_services ps
      where ps.professional_id = new.professional_id and ps.service_id = new.service_id
    ) then
      raise exception using errcode = 'P0001', message = 'service_not_offered';
    end if;
    v_problem := private.slot_problem(new.professional_id, new.starts_at, new.ends_at, new.id);
    if v_problem is not null then
      raise exception using errcode = 'P0001', message = v_problem;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.tg_appointments_history()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce((select auth.uid()), new.updated_by);
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events
      (organization_id, appointment_id, event_type, actor_id, to_status, to_starts_at, to_ends_at, to_professional_id)
    values
      (new.organization_id, new.id, 'created', coalesce((select auth.uid()), new.created_by),
       new.status, new.starts_at, new.ends_at, new.professional_id);
    return new;
  end if;

  if new.starts_at is distinct from old.starts_at or new.professional_id is distinct from old.professional_id then
    insert into public.appointment_events
      (organization_id, appointment_id, event_type, actor_id,
       from_starts_at, from_ends_at, to_starts_at, to_ends_at, from_professional_id, to_professional_id)
    values
      (new.organization_id, new.id, 'rescheduled', v_actor,
       old.starts_at, old.ends_at, new.starts_at, new.ends_at, old.professional_id, new.professional_id);
  end if;

  if new.status is distinct from old.status then
    insert into public.appointment_events
      (organization_id, appointment_id, event_type, actor_id, from_status, to_status)
    values
      (new.organization_id, new.id, 'status_changed', v_actor, old.status, new.status);
  end if;

  if new.notes is distinct from old.notes then
    insert into public.appointment_events (organization_id, appointment_id, event_type, actor_id)
    values (new.organization_id, new.id, 'details_updated', v_actor);
  end if;

  return new;
end;
$$;

-- Agenda: cambia el tipo de retorno, así que se elimina y se vuelve a crear ------
drop function public.agenda_appointments(uuid, date, date, uuid, uuid, public.appointment_status[]);

create function public.agenda_appointments(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_professional_id uuid default null,
  p_service_id uuid default null,
  p_statuses public.appointment_status[] default null
)
returns table (
  id uuid,
  professional_id uuid,
  professional_name text,
  professional_color text,
  service_id uuid,
  service_name text,
  contact_id uuid,
  contact_name text,
  contact_phone text,
  contact_email text,
  status public.appointment_status,
  starts_at timestamptz,
  ends_at timestamptz,
  local_start text,
  local_end text,
  notes text
)
language sql stable security invoker
set search_path = ''
as $$
  with bounds as (
    select o.timezone,
           (p_from::timestamp at time zone o.timezone) as lo,
           ((p_to + 1)::timestamp at time zone o.timezone) as hi
    from public.organizations o
    where o.id = p_organization_id
  )
  select a.id, a.professional_id, p.display_name, p.color,
         a.service_id, s.name, a.contact_id, c.full_name, c.phone, c.email,
         a.status, a.starts_at, a.ends_at,
         to_char(a.starts_at at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'),
         to_char(a.ends_at at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'),
         a.notes
  from bounds b
  join public.appointments a
    on a.organization_id = p_organization_id and a.starts_at >= b.lo and a.starts_at < b.hi
  join public.professionals p on p.id = a.professional_id
  join public.services s on s.id = a.service_id
  join public.contacts c on c.id = a.contact_id
  where (p_professional_id is null or a.professional_id = p_professional_id)
    and (p_service_id is null or a.service_id = p_service_id)
    and (p_statuses is null or a.status = any (p_statuses))
  order by a.starts_at, p.display_name;
$$;

revoke execute on function public.agenda_appointments(uuid, date, date, uuid, uuid, public.appointment_status[]) from public, anon;
grant execute on function public.agenda_appointments(uuid, date, date, uuid, uuid, public.appointment_status[]) to authenticated, service_role;

-- Agendar: sin parámetro de mascota -------------------------------------------
drop function public.book_appointment(uuid, uuid, uuid, date, time, public.appointment_status, text, text, uuid);

-- Agenda una cita. La fecha y hora son locales del espacio; la base las convierte.
-- p_idempotency_key evita duplicados por doble clic o reintentos.
create function public.book_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_contact_id uuid,
  p_local_date date,
  p_local_time time,
  p_status public.appointment_status default 'pending',
  p_notes text default null,
  p_idempotency_key uuid default null
)
returns public.appointments
language plpgsql volatile security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_timezone text;
  v_existing public.appointments;
  v_new public.appointments;
  v_starts timestamptz;
begin
  select p.organization_id, o.timezone into v_org, v_timezone
  from public.professionals p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_professional_id;
  if v_org is null then
    raise exception using errcode = 'P0001', message = 'professional_not_found';
  end if;

  -- Serializa con otras reservas del mismo profesional.
  perform private.lock_professional(p_professional_id);

  if p_idempotency_key is not null then
    select * into v_existing from public.appointments a
    where a.organization_id = v_org and a.idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  v_starts := (p_local_date + p_local_time) at time zone v_timezone;

  insert into public.appointments
    (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status, notes, idempotency_key)
  values
    (v_org, p_professional_id, p_service_id, p_contact_id, v_starts, v_starts + interval '1 minute',
     coalesce(p_status, 'pending'), p_notes, p_idempotency_key)
  returning * into v_new;

  return v_new;
end;
$$;

revoke execute on function public.book_appointment(uuid, uuid, uuid, date, time, public.appointment_status, text, uuid) from public, anon;
grant execute on function public.book_appointment(uuid, uuid, uuid, date, time, public.appointment_status, text, uuid) to authenticated, service_role;

-- Columnas ---------------------------------------------------------------------
alter table public.appointments drop column pet_name;
alter table public.professional_types drop column uses_pet_name;

comment on table public.contacts is 'Paciente o contacto. Exige nombre y al menos un medio de contacto.';
