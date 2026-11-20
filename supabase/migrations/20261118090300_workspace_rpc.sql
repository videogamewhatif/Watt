-- =============================================================================
-- Wattalis · 0004 · Operaciones (RPC)
-- Operaciones de varios pasos que deben ser atómicas. Las que no requieren
-- privilegios usan SECURITY INVOKER para que RLS siga decidiendo. Las que sí
-- (crear espacio, invitaciones) verifican la autorización explícitamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Crear espacio de trabajo + primera membresía administrativa (atómico).
-- El rol siempre es 'admin': no se acepta ningún rol desde el navegador.
-- -----------------------------------------------------------------------------
create function public.create_organization(
  p_name text,
  p_kind public.organization_kind,
  p_timezone text default 'America/Mexico_City',
  p_also_professional boolean default false,
  p_professional_type text default 'medico',
  p_specialty text default null,
  p_display_name text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org_id uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  insert into public.organizations (name, kind, timezone, created_by)
  values (p_name, p_kind, coalesce(nullif(btrim(p_timezone), ''), 'America/Mexico_City'), v_uid)
  returning id into v_org_id;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org_id, v_uid, 'admin');

  if p_also_professional then
    select coalesce(nullif(btrim(p_display_name), ''), nullif(btrim(pr.full_name), ''), split_part(pr.email, '@', 1))
      into v_name
    from public.profiles pr where pr.id = v_uid;

    insert into public.professionals (organization_id, user_id, display_name, professional_type, specialty)
    values (v_org_id, v_uid, coalesce(v_name, 'Profesional'), coalesce(p_professional_type, 'medico'), p_specialty);
  end if;

  return v_org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Invitaciones
-- -----------------------------------------------------------------------------
create function public.create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.member_role,
  p_professional_id uuid default null,
  p_valid_days integer default 7
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if not private.is_admin_of(p_organization_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;
  if p_valid_days < 1 or p_valid_days > 30 then
    raise exception using errcode = 'P0001', message = 'invalid_range';
  end if;
  if exists (
    select 1 from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.organization_id = p_organization_id and pr.email = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'already_member';
  end if;
  if p_professional_id is not null then
    if p_role = 'reception' then
      raise exception using errcode = 'P0001', message = 'invalid_professional_link';
    end if;
    if not exists (
      select 1 from public.professionals p
      where p.id = p_professional_id and p.organization_id = p_organization_id and p.user_id is null
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_professional_link';
    end if;
  end if;

  -- Una sola invitación vigente por correo y espacio.
  update public.invitations i set revoked_at = now()
  where i.organization_id = p_organization_id and i.email = v_email
    and i.accepted_at is null and i.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(days => p_valid_days);

  insert into public.invitations
    (organization_id, email, role, professional_id, token_hash, expires_at, created_by)
  values
    (p_organization_id, v_email, p_role, p_professional_id,
     encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires, (select auth.uid()))
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

-- Información mínima para la pantalla de aceptación.
create function public.get_invitation(p_token text)
returns table (
  organization_name text,
  role public.member_role,
  email_hint text,
  status text,
  email_matches boolean,
  expires_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_user_email text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  select * into v_inv from public.invitations i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then
    return query select null::text, null::public.member_role, null::text, 'invalid'::text, false, null::timestamptz;
    return;
  end if;
  select lower(u.email) into v_user_email from auth.users u where u.id = (select auth.uid());

  return query
  select o.name,
         v_inv.role,
         left(v_inv.email, 2) || '•••@' || split_part(v_inv.email, '@', 2),
         case
           when v_inv.revoked_at is not null then 'revoked'
           when v_inv.accepted_at is not null then 'used'
           when v_inv.expires_at <= now() then 'expired'
           else 'valid'
         end,
         coalesce(v_user_email = v_inv.email, false),
         v_inv.expires_at
  from public.organizations o where o.id = v_inv.organization_id;
end;
$$;

-- Acepta una invitación: un solo uso, vigente y para el correo VERIFICADO de la cuenta.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitations;
  v_email text;
  v_confirmed_at timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_inv from public.invitations i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_invalid';
  end if;
  if v_inv.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'invitation_revoked';
  end if;
  if v_inv.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'invitation_used';
  end if;
  if v_inv.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'invitation_expired';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at
  from auth.users u where u.id = v_uid;

  if v_confirmed_at is null then
    raise exception using errcode = 'P0001', message = 'email_not_verified';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception using errcode = 'P0001', message = 'invitation_email_mismatch';
  end if;
  if exists (
    select 1 from public.memberships m where m.organization_id = v_inv.organization_id and m.user_id = v_uid
  ) then
    raise exception using errcode = 'P0001', message = 'already_member';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (v_inv.organization_id, v_uid, v_inv.role);

  if v_inv.professional_id is not null then
    update public.professionals p set user_id = v_uid
    where p.id = v_inv.professional_id and p.organization_id = v_inv.organization_id and p.user_id is null;
  end if;

  update public.invitations i set accepted_at = now(), accepted_by = v_uid where i.id = v_inv.id;

  return v_inv.organization_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Horario semanal: reemplazo atómico. Devuelve cuántas citas futuras vigentes
-- quedaron fuera del nuevo horario (no se cancelan: se avisan).
-- p_rules: [{"weekday":1,"start_time":"09:00","end_time":"13:00"}, …]
-- -----------------------------------------------------------------------------
create function public.set_weekly_schedule(p_professional_id uuid, p_rules jsonb)
returns integer
language plpgsql volatile security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_outside integer;
begin
  select p.organization_id into v_org from public.professionals p where p.id = p_professional_id;
  if v_org is null or not private.is_admin_of(v_org) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_schedule';
  end if;

  perform private.lock_professional(p_professional_id);

  delete from public.availability_rules r where r.professional_id = p_professional_id;

  insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
  select v_org, p_professional_id, (r ->> 'weekday')::smallint, (r ->> 'start_time')::time, (r ->> 'end_time')::time
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) as r;

  select count(*) into v_outside
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
  where a.professional_id = p_professional_id
    and a.status in ('pending', 'confirmed')
    and a.starts_at > now()
    and not exists (
      select 1 from public.availability_rules r
      where r.professional_id = a.professional_id
        and r.weekday = extract(isodow from (a.starts_at at time zone o.timezone)::date)
        and (a.starts_at at time zone o.timezone) >= (a.starts_at at time zone o.timezone)::date + r.start_time
        and (a.ends_at at time zone o.timezone) <= (a.starts_at at time zone o.timezone)::date + r.end_time
    );

  return v_outside;
end;
$$;

-- -----------------------------------------------------------------------------
-- Citas
-- -----------------------------------------------------------------------------
-- Agenda una cita. La fecha y hora son locales del espacio; la base las convierte.
-- p_idempotency_key evita duplicados por doble clic o reintentos.
create function public.book_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_contact_id uuid,
  p_local_date date,
  p_local_time time,
  p_status public.appointment_status default 'pending',
  p_pet_name text default null,
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
    (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status, pet_name, notes, idempotency_key)
  values
    (v_org, p_professional_id, p_service_id, p_contact_id, v_starts, v_starts + interval '1 minute',
     coalesce(p_status, 'pending'), p_pet_name, p_notes, p_idempotency_key)
  returning * into v_new;

  return v_new;
end;
$$;

-- Reprograma conservando la misma cita. Si falla, la transacción completa se
-- revierte y la cita permanece en su horario original.
create function public.reschedule_appointment(
  p_appointment_id uuid,
  p_local_date date,
  p_local_time time,
  p_professional_id uuid default null
)
returns public.appointments
language plpgsql volatile security invoker
set search_path = ''
as $$
declare
  v_current public.appointments;
  v_target uuid;
  v_timezone text;
  v_updated public.appointments;
begin
  select * into v_current from public.appointments a where a.id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'appointment_not_found';
  end if;
  v_target := coalesce(p_professional_id, v_current.professional_id);

  -- Bloqueo en orden estable para evitar interbloqueos.
  perform private.lock_professional(x.id)
  from (select unnest(array[v_current.professional_id, v_target]) as id order by 1) x;

  select o.timezone into v_timezone from public.organizations o where o.id = v_current.organization_id;

  update public.appointments a
  set starts_at = (p_local_date + p_local_time) at time zone v_timezone,
      professional_id = v_target
  where a.id = p_appointment_id
  returning * into v_updated;

  if v_updated.id is null then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return v_updated;
end;
$$;

create function public.set_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_reason text default null
)
returns public.appointments
language plpgsql volatile security invoker
set search_path = ''
as $$
declare
  v_updated public.appointments;
begin
  update public.appointments a
  set status = p_status,
      cancellation_reason = case when p_status = 'cancelled' then nullif(btrim(p_reason), '') else null end
  where a.id = p_appointment_id
  returning * into v_updated;

  if v_updated.id is null then
    raise exception using errcode = 'P0001', message = 'appointment_not_found';
  end if;
  return v_updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contactos: búsqueda y posibles duplicados (respetan RLS: nunca revelan
-- contactos fuera de los permisos de quien consulta).
-- -----------------------------------------------------------------------------
create function public.search_contacts(
  p_organization_id uuid,
  p_query text default null,
  p_limit integer default 25
)
returns setof public.contacts
language sql stable security invoker
set search_path = ''
as $$
  select c.*
  from public.contacts c
  where c.organization_id = p_organization_id
    and (
      coalesce(btrim(p_query), '') = ''
      or c.search_name like '%' || private.unaccent_lower(btrim(p_query)) || '%'
      or (private.phone_digits(p_query) is not null and length(private.phone_digits(p_query)) >= 3
          and c.phone_digits like '%' || private.phone_digits(p_query) || '%')
      or lower(c.email) like '%' || lower(btrim(p_query)) || '%'
    )
  order by c.search_name
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

create function public.find_similar_contacts(
  p_organization_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null
)
returns setof public.contacts
language sql stable security invoker
set search_path = ''
as $$
  select c.*
  from public.contacts c
  where c.organization_id = p_organization_id
    and (
      (length(private.phone_digits(p_phone)) >= 7
        and right(c.phone_digits, 10) = right(private.phone_digits(p_phone), 10))
      or (nullif(btrim(p_email), '') is not null and lower(c.email) = lower(btrim(p_email)))
      or (length(btrim(coalesce(p_full_name, ''))) >= 3
        and c.search_name = private.unaccent_lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g')))
    )
  order by c.search_name
  limit 5;
$$;

-- -----------------------------------------------------------------------------
-- Resumen de Inicio. RLS limita al rol Profesional a su propia actividad.
-- -----------------------------------------------------------------------------
create function public.dashboard_summary(p_organization_id uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_result jsonb;
begin
  select o.timezone into v_timezone from public.organizations o where o.id = p_organization_id;
  if v_timezone is null then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  v_today := (now() at time zone v_timezone)::date;

  with today as (
    select a.* from public.appointments a
    where a.organization_id = p_organization_id
      and a.starts_at >= (v_today::timestamp at time zone v_timezone)
      and a.starts_at < ((v_today + 1)::timestamp at time zone v_timezone)
  ),
  upcoming as (
    select a.id, a.starts_at, a.status,
           to_char(a.starts_at at time zone v_timezone, 'YYYY-MM-DD"T"HH24:MI') as local_start,
           c.full_name as contact_name, s.name as service_name, p.display_name as professional_name
    from public.appointments a
    join public.contacts c on c.id = a.contact_id
    join public.services s on s.id = a.service_id
    join public.professionals p on p.id = a.professional_id
    where a.organization_id = p_organization_id
      and a.status in ('pending', 'confirmed')
      and a.starts_at > now()
    order by a.starts_at
    limit 1
  )
  select jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'timezone', v_timezone,
    'today_total', (select count(*) from today where status <> 'cancelled'),
    'today_pending', (select count(*) from today where status = 'pending'),
    'today_confirmed', (select count(*) from today where status = 'confirmed'),
    'today_attended', (select count(*) from today where status = 'attended'),
    'today_no_show', (select count(*) from today where status = 'no_show'),
    'today_cancelled', (select count(*) from today where status = 'cancelled'),
    'upcoming_pending', (
      select count(*) from public.appointments a
      where a.organization_id = p_organization_id and a.status = 'pending' and a.starts_at > now()
    ),
    'next_appointment', (select to_jsonb(u) from upcoming u),
    'setup', jsonb_build_object(
      'has_professional', exists (select 1 from public.professionals p where p.organization_id = p_organization_id),
      'has_service', exists (select 1 from public.services s where s.organization_id = p_organization_id),
      'has_assignment', exists (select 1 from public.professional_services ps where ps.organization_id = p_organization_id),
      'has_schedule', exists (select 1 from public.availability_rules r where r.organization_id = p_organization_id),
      'has_appointment', exists (select 1 from public.appointments a where a.organization_id = p_organization_id)
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Citas futuras vigentes de un profesional (aviso al desactivar).
create function public.professional_future_appointments(p_professional_id uuid)
returns integer
language sql stable security invoker
set search_path = ''
as $$
  select count(*)::integer from public.appointments a
  where a.professional_id = p_professional_id
    and a.status in ('pending', 'confirmed')
    and a.starts_at > now();
$$;

-- -----------------------------------------------------------------------------
-- Privilegios de ejecución: nada para anon; las funciones internas no se exponen.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

revoke execute on all functions in schema private from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;
