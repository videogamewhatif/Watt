-- =============================================================================
-- Wattalis · 0003 · Agenda
-- Reglas de disponibilidad garantizadas en PostgreSQL:
--   * Una cita cabe completa en un bloque del horario semanal (hora local del espacio).
--   * No invade bloqueos ni otras citas vigentes del mismo profesional ([inicio, fin)).
--   * Las escrituras de citas y bloqueos de un mismo profesional se serializan con un
--     bloqueo de fila sobre el profesional; la restricción de exclusión
--     appointments_no_overlap es la garantía final aunque alguien omita este camino.
-- =============================================================================

-- Bloquea la fila del profesional hasta el fin de la transacción.
create function private.lock_professional(p_professional_id uuid)
returns public.professionals
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_professional public.professionals;
begin
  select * into v_professional
  from public.professionals p
  where p.id = p_professional_id
  for no key update;
  return v_professional;
end;
$$;

-- Devuelve el motivo por el que un intervalo no está disponible, o null si lo está.
-- Es VOLATILE a propósito: tras esperar el bloqueo debe ver lo confirmado por otros.
create function private.slot_problem(
  p_professional_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day date;
begin
  select o.timezone into v_timezone
  from public.professionals p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_professional_id;

  v_local_start := p_starts_at at time zone v_timezone;
  v_local_end := p_ends_at at time zone v_timezone;
  v_day := v_local_start::date;

  if not exists (
    select 1 from public.availability_rules r
    where r.professional_id = p_professional_id
      and r.weekday = extract(isodow from v_day)
      and v_local_start >= v_day + r.start_time
      and v_local_end <= v_day + r.end_time
  ) then
    return 'outside_schedule';
  end if;

  if exists (
    select 1 from public.time_off t
    where t.professional_id = p_professional_id
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return 'blocked';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = p_professional_id
      and a.status in ('pending', 'confirmed')
      and a.id is distinct from p_exclude_appointment_id
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return 'slot_taken';
  end if;

  return null;
end;
$$;

-- Transiciones de estado permitidas.
create function private.assert_status_transition(
  p_from public.appointment_status,
  p_to public.appointment_status,
  p_starts_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_from = p_to then
    return;
  end if;
  if p_from in ('pending', 'confirmed') and p_to in ('attended', 'no_show') then
    if p_starts_at > now() then
      raise exception using errcode = 'P0001', message = 'appointment_not_started',
        detail = 'Solo se puede marcar como atendida o no asistió una cita que ya comenzó.';
    end if;
    return;
  end if;
  if p_from = 'pending' and p_to in ('confirmed', 'cancelled') then
    return;
  end if;
  if p_from = 'confirmed' and p_to = 'cancelled' then
    return;
  end if;
  -- Corrección de un registro cerrado: atendida <-> no asistió.
  if p_from in ('attended', 'no_show') and p_to in ('attended', 'no_show') then
    return;
  end if;
  raise exception using errcode = 'P0001', message = 'invalid_status_transition',
    detail = format('No se puede pasar de %s a %s.', p_from, p_to);
end;
$$;

-- -----------------------------------------------------------------------------
-- Citas: validación antes de escribir
-- -----------------------------------------------------------------------------
create function private.tg_appointments_before_write()
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
    new.pet_name := nullif(btrim(new.pet_name), '');
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
    new.pet_name := nullif(btrim(new.pet_name), '');
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

create trigger appointments_before_write before insert or update on public.appointments
  for each row execute function private.tg_appointments_before_write();

-- -----------------------------------------------------------------------------
-- Citas: historial (quién y qué cambió). Sin datos del paciente.
-- -----------------------------------------------------------------------------
create function private.tg_appointments_history()
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

  if new.notes is distinct from old.notes or new.pet_name is distinct from old.pet_name then
    insert into public.appointment_events (organization_id, appointment_id, event_type, actor_id)
    values (new.organization_id, new.id, 'details_updated', v_actor);
  end if;

  return new;
end;
$$;

create trigger appointments_history after insert or update on public.appointments
  for each row execute function private.tg_appointments_history();

-- -----------------------------------------------------------------------------
-- Bloqueos: no pueden ocultar ni invalidar citas vigentes.
-- -----------------------------------------------------------------------------
create function private.tg_time_off_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_professional public.professionals;
  v_conflicts integer;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception using errcode = 'P0001', message = 'organization_immutable';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(v_uid, new.created_by);
    new.created_at := now();
  end if;
  new.updated_at := now();
  new.note := nullif(btrim(new.note), '');

  if v_uid is not null and new.organization_id not in (select private.admin_org_ids()) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  v_professional := private.lock_professional(new.professional_id);
  if v_professional.id is null or v_professional.organization_id <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'professional_not_found';
  end if;

  select count(*) into v_conflicts
  from public.appointments a
  where a.professional_id = new.professional_id
    and a.status in ('pending', 'confirmed')
    and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)');

  if v_conflicts > 0 then
    raise exception using errcode = 'P0001', message = 'time_off_conflict',
      detail = v_conflicts::text,
      hint = 'Reprograma o cancela las citas vigentes de ese periodo antes de crear el bloqueo.';
  end if;

  return new;
end;
$$;

create trigger time_off_before_write before insert or update on public.time_off
  for each row execute function private.tg_time_off_before_write();

-- Cambios de horario semanal también se serializan con las reservas del profesional.
create function private.tg_availability_rules_lock()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.lock_professional(coalesce(new.professional_id, old.professional_id));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger availability_rules_lock before insert or update or delete on public.availability_rules
  for each row execute function private.tg_availability_rules_lock();

-- -----------------------------------------------------------------------------
-- Disponibilidad: horarios libres para un profesional y servicio.
-- Solo para quien puede agendar con ese profesional.
-- -----------------------------------------------------------------------------
create function public.get_available_slots(
  p_professional_id uuid,
  p_service_id uuid,
  p_from date,
  p_days integer default 1,
  p_exclude_appointment_id uuid default null
)
returns table (starts_at timestamptz, ends_at timestamptz, local_start text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_professional public.professionals;
  v_organization public.organizations;
  v_duration interval;
  v_step interval;
begin
  select * into v_professional from public.professionals p where p.id = p_professional_id;
  if not found or not (
    v_professional.organization_id in (select private.staff_org_ids())
    or coalesce(v_professional.user_id = (select auth.uid()), false)
  ) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_days < 1 or p_days > 31 then
    raise exception using errcode = 'P0001', message = 'invalid_range';
  end if;
  if not v_professional.active then
    return;
  end if;

  select * into v_organization from public.organizations o where o.id = v_professional.organization_id;

  select make_interval(mins => s.duration_minutes) into v_duration
  from public.services s
  join public.professional_services ps on ps.service_id = s.id and ps.professional_id = v_professional.id
  where s.id = p_service_id and s.active;
  if v_duration is null then
    return;
  end if;

  v_step := make_interval(mins => v_organization.slot_interval_minutes);

  return query
  with days as (
    select (p_from + i) as day from generate_series(0, p_days - 1) as i
  ),
  windows as (
    select d.day + r.start_time as w_start, d.day + r.end_time as w_end
    from days d
    join public.availability_rules r
      on r.professional_id = v_professional.id and r.weekday = extract(isodow from d.day)
  ),
  candidates as (
    select gs as local_start
    from windows w
    cross join lateral generate_series(w.w_start, w.w_end - v_duration, v_step) as gs
  ),
  slots as (
    select (c.local_start at time zone v_organization.timezone) as s_start, c.local_start
    from candidates c
  )
  select s.s_start, s.s_start + v_duration, to_char(s.local_start, 'YYYY-MM-DD"T"HH24:MI')
  from slots s
  where s.s_start > now()
    and not exists (
      select 1 from public.appointments a
      where a.professional_id = v_professional.id
        and a.status in ('pending', 'confirmed')
        and a.id is distinct from p_exclude_appointment_id
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(s.s_start, s.s_start + v_duration, '[)')
    )
    and not exists (
      select 1 from public.time_off t
      where t.professional_id = v_professional.id
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(s.s_start, s.s_start + v_duration, '[)')
    )
  order by s.s_start;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agenda: citas y bloqueos de un rango de fechas locales del espacio.
-- SECURITY INVOKER: RLS decide qué filas ve cada rol.
-- Las horas locales se calculan en la base con la zona del espacio, así que la
-- zona del navegador nunca interviene.
-- -----------------------------------------------------------------------------
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
  pet_name text,
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
         a.pet_name, a.status, a.starts_at, a.ends_at,
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

create function public.agenda_time_off(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_professional_id uuid default null
)
returns table (
  id uuid,
  professional_id uuid,
  kind public.time_off_kind,
  note text,
  starts_at timestamptz,
  ends_at timestamptz,
  local_start text,
  local_end text
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
  select t.id, t.professional_id, t.kind, t.note, t.starts_at, t.ends_at,
         to_char(t.starts_at at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'),
         to_char(t.ends_at at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI')
  from bounds b
  join public.time_off t
    on t.organization_id = p_organization_id
   and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(b.lo, b.hi, '[)')
  where p_professional_id is null or t.professional_id = p_professional_id
  order by t.starts_at;
$$;
