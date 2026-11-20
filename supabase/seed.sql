-- =============================================================================
-- Wattalis · Datos ficticios SOLO PARA DESARROLLO
--
-- Lo ejecuta automáticamente `supabase db reset` en el entorno local. Nunca se
-- aplica con `supabase db push`. NO lo ejecutes en producción.
--
-- Es reproducible: borra y vuelve a crear únicamente los registros demo
-- (identificadores fijos). Las fechas se calculan a partir de "hoy" en
-- America/Mexico_City para que siempre haya citas cercanas.
--
-- Cuentas (contraseña para todas: Wattalis-demo-2026):
--   admin@clinica-arboleda.test        Administración · Clínica Arboleda
--   recepcion@clinica-arboleda.test    Recepción · Clínica Arboleda
--                                      y Administración · Veterinaria Patitas
--   ana.ruiz@clinica-arboleda.test     Profesional · Clínica Arboleda
--   luis.herrera@consultorio.test      Administración + Profesional · Consultorio Dr. Herrera
-- =============================================================================

do $seed$
declare
  -- Cuentas
  u_laura  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  u_mario  constant uuid := 'a0000000-0000-4000-8000-000000000002';
  u_ana    constant uuid := 'a0000000-0000-4000-8000-000000000003';
  u_luis   constant uuid := 'a0000000-0000-4000-8000-000000000004';
  -- Espacios
  o_clinic constant uuid := 'b0000000-0000-4000-8000-000000000001';
  o_indep  constant uuid := 'b0000000-0000-4000-8000-000000000002';
  o_vet    constant uuid := 'b0000000-0000-4000-8000-000000000003';
  -- Profesionales
  p_ruiz   constant uuid := 'c0000000-0000-4000-8000-000000000001';
  p_salas  constant uuid := 'c0000000-0000-4000-8000-000000000002';
  p_luis   constant uuid := 'c0000000-0000-4000-8000-000000000003';
  p_soto   constant uuid := 'c0000000-0000-4000-8000-000000000004';
  -- Servicios
  s_consulta    constant uuid := 'd0000000-0000-4000-8000-000000000001';
  s_seguimiento constant uuid := 'd0000000-0000-4000-8000-000000000002';
  s_valoracion  constant uuid := 'd0000000-0000-4000-8000-000000000003';
  s_limpieza    constant uuid := 'd0000000-0000-4000-8000-000000000004';
  s_primera     constant uuid := 'd0000000-0000-4000-8000-000000000005';
  s_subsec      constant uuid := 'd0000000-0000-4000-8000-000000000006';
  s_vet         constant uuid := 'd0000000-0000-4000-8000-000000000007';
  s_vacuna      constant uuid := 'd0000000-0000-4000-8000-000000000008';
  -- Contactos
  c_maria   constant uuid := 'e0000000-0000-4000-8000-000000000001';
  c_jose    constant uuid := 'e0000000-0000-4000-8000-000000000002';
  c_lupita  constant uuid := 'e0000000-0000-4000-8000-000000000003';
  c_carlos  constant uuid := 'e0000000-0000-4000-8000-000000000004';
  c_sofia   constant uuid := 'e0000000-0000-4000-8000-000000000005';
  c_ricardo constant uuid := 'e0000000-0000-4000-8000-000000000006';
  c_elena   constant uuid := 'e0000000-0000-4000-8000-000000000007';
  c_hector  constant uuid := 'e0000000-0000-4000-8000-000000000008';
  c_paty    constant uuid := 'e0000000-0000-4000-8000-000000000009';
  c_andrea  constant uuid := 'e0000000-0000-4000-8000-000000000010';
  c_raul    constant uuid := 'e0000000-0000-4000-8000-000000000011';

  tz constant text := 'America/Mexico_City';
  v_password text := extensions.crypt('Wattalis-demo-2026', extensions.gen_salt('bf'));
  v_today date := (now() at time zone tz)::date;
  w date[]; -- días hábiles a partir de hoy
  past1 date; -- último día hábil anterior a hoy
  v_id uuid;
  r record;
begin
  -- ---------------------------------------------------------------------------
  -- Limpieza de una ejecución anterior (solo registros demo)
  -- ---------------------------------------------------------------------------
  delete from public.organizations where id in (o_clinic, o_indep, o_vet);
  delete from auth.users where id in (u_laura, u_mario, u_ana, u_luis);

  select array_agg(d::date order by d) into w
  from generate_series(v_today, v_today + 14, interval '1 day') d
  where extract(isodow from d) between 1 and 5;

  select max(d::date) into past1
  from generate_series(v_today - 7, v_today - 1, interval '1 day') d
  where extract(isodow from d) between 1 and 5;

  -- ---------------------------------------------------------------------------
  -- Cuentas (correo confirmado)
  -- ---------------------------------------------------------------------------
  for r in
    select * from (values
      (u_laura, 'admin@clinica-arboleda.test', 'Laura Gómez'),
      (u_mario, 'recepcion@clinica-arboleda.test', 'Mario Pérez'),
      (u_ana, 'ana.ruiz@clinica-arboleda.test', 'Ana Ruiz'),
      (u_luis, 'luis.herrera@consultorio.test', 'Luis Herrera')
    ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email, v_password, now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.full_name), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), r.id, r.id::text,
      jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  end loop;

  -- ---------------------------------------------------------------------------
  -- Espacios y membresías
  -- ---------------------------------------------------------------------------
  insert into public.organizations (id, name, kind, timezone, created_by) values
    (o_clinic, 'Clínica Arboleda (demo)', 'clinic', tz, u_laura),
    (o_indep, 'Consultorio Dr. Herrera (demo)', 'independent', tz, u_luis),
    (o_vet, 'Veterinaria Patitas (demo)', 'clinic', tz, u_mario);

  insert into public.memberships (organization_id, user_id, role) values
    (o_clinic, u_laura, 'admin'),
    (o_clinic, u_mario, 'reception'),
    (o_clinic, u_ana, 'professional'),
    (o_indep, u_luis, 'admin'),
    (o_vet, u_mario, 'admin');

  -- ---------------------------------------------------------------------------
  -- Profesionales (Dr. Salas y MVZ Soto existen sin cuenta de acceso)
  -- ---------------------------------------------------------------------------
  insert into public.professionals (id, organization_id, user_id, display_name, professional_type, specialty, color, phone) values
    (p_ruiz, o_clinic, u_ana, 'Dra. Ana Ruiz', 'medico', 'Medicina general', '#0f766e', null),
    (p_salas, o_clinic, null, 'Dr. Jorge Salas', 'dentista', 'Odontología general', '#7c3aed', '55 5010 2030'),
    (p_luis, o_indep, u_luis, 'Dr. Luis Herrera', 'medico', 'Medicina interna', '#b45309', null),
    (p_soto, o_vet, null, 'MVZ Daniela Soto', 'veterinario', 'Pequeñas especies', '#be185d', null);

  insert into public.services (id, organization_id, name, duration_minutes, description) values
    (s_consulta, o_clinic, 'Consulta general', 30, null),
    (s_seguimiento, o_clinic, 'Revisión de seguimiento', 20, 'Cita breve de control.'),
    (s_valoracion, o_clinic, 'Valoración dental', 30, null),
    (s_limpieza, o_clinic, 'Limpieza dental', 45, null),
    (s_primera, o_indep, 'Consulta de primera vez', 45, null),
    (s_subsec, o_indep, 'Consulta subsecuente', 30, null),
    (s_vet, o_vet, 'Consulta veterinaria', 30, null),
    (s_vacuna, o_vet, 'Vacunación', 15, null);

  insert into public.professional_services (organization_id, professional_id, service_id) values
    (o_clinic, p_ruiz, s_consulta),
    (o_clinic, p_ruiz, s_seguimiento),
    (o_clinic, p_salas, s_valoracion),
    (o_clinic, p_salas, s_limpieza),
    (o_indep, p_luis, s_primera),
    (o_indep, p_luis, s_subsec),
    (o_vet, p_soto, s_vet),
    (o_vet, p_soto, s_vacuna);

  -- Horarios semanales (horas locales). Ruiz y Herrera con horario partido.
  insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
  select o_clinic, p_ruiz, d, t.s, t.e from generate_series(1, 5) d,
    (values (time '09:00', time '13:00'), (time '15:00', time '18:00')) t(s, e);
  insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
  select o_clinic, p_salas, d, t.s, t.e from generate_series(1, 5) d,
    (values (time '10:00', time '14:00'), (time '16:00', time '19:00')) t(s, e);
  insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
  values (o_clinic, p_salas, 6, '09:00', '13:00');
  insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
  select o_indep, p_luis, d, t.s, t.e from generate_series(1, 5) d,
    (values (time '08:00', time '12:00'), (time '16:00', time '19:00')) t(s, e);
  insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
  select o_vet, p_soto, d, '10:00', '15:00' from generate_series(1, 6) d;

  -- ---------------------------------------------------------------------------
  -- Contactos (todos ficticios)
  -- ---------------------------------------------------------------------------
  insert into public.contacts (id, organization_id, full_name, phone, email, created_by) values
    (c_maria, o_clinic, 'María Fernanda López', '55 1234 0001', null, u_mario),
    (c_jose, o_clinic, 'José Ramírez Torres', '55 1234 0002', 'jose.ramirez@correo.test', u_mario),
    (c_lupita, o_clinic, 'Guadalupe Sánchez', null, 'lupita.sanchez@correo.test', u_mario),
    (c_carlos, o_clinic, 'Carlos Medina', '55 1234 0004', null, u_mario),
    (c_sofia, o_clinic, 'Sofía Castillo', '55 1234 0005', null, u_laura),
    (c_ricardo, o_clinic, 'Ricardo Núñez', '55 1234 0006', null, u_mario),
    (c_elena, o_indep, 'Elena Vargas', '33 2000 0001', null, u_luis),
    (c_hector, o_indep, 'Héctor Morales', '33 2000 0002', 'hector.morales@correo.test', u_luis),
    (c_paty, o_indep, 'Patricia Ríos', null, 'paty.rios@correo.test', u_luis),
    (c_andrea, o_vet, 'Andrea Flores', '55 3000 0001', null, u_mario),
    (c_raul, o_vet, 'Raúl Domínguez', '55 3000 0002', null, u_mario);

  -- ---------------------------------------------------------------------------
  -- Bloqueos
  -- ---------------------------------------------------------------------------
  insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind, note, created_by) values
    (o_clinic, p_ruiz, (w[2] + time '11:00') at time zone tz, (w[2] + time '12:00') at time zone tz, 'absence', 'Junta clínica', u_laura),
    (o_clinic, p_salas, (w[3]::timestamp) at time zone tz, ((w[3] + 1)::timestamp) at time zone tz, 'vacation', 'Vacaciones', u_laura),
    (o_indep, p_luis, (w[3] + time '08:00') at time zone tz, (w[3] + time '10:00') at time zone tz, 'absence', 'Congreso', u_luis);

  -- ---------------------------------------------------------------------------
  -- Citas: las que ya pasaron quedan atendidas (o "no asistió"); las futuras,
  -- pendientes o confirmadas.
  -- ---------------------------------------------------------------------------
  create temporary table demo_appts (
    org uuid, prof uuid, svc uuid, contact uuid, day date, at time, future_status public.appointment_status,
    past_status public.appointment_status, pet text, by_user uuid
  ) on commit drop;

  insert into demo_appts values
    -- Día hábil anterior
    (o_clinic, p_ruiz, s_consulta, c_maria, past1, '09:00', 'confirmed', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_seguimiento, c_carlos, past1, '10:00', 'confirmed', 'no_show', null, u_mario),
    (o_clinic, p_salas, s_limpieza, c_jose, past1, '10:30', 'confirmed', 'attended', null, u_mario),
    (o_indep, p_luis, s_subsec, c_elena, past1, '08:30', 'confirmed', 'attended', null, u_luis),
    -- Primer día hábil (hoy, si es entre semana)
    (o_clinic, p_ruiz, s_consulta, c_lupita, w[1], '09:00', 'confirmed', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_seguimiento, c_sofia, w[1], '09:30', 'pending', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_consulta, c_ricardo, w[1], '10:30', 'confirmed', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_consulta, c_jose, w[1], '12:00', 'pending', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_consulta, c_maria, w[1], '16:00', 'pending', 'attended', null, u_mario),
    (o_clinic, p_salas, s_valoracion, c_carlos, w[1], '10:00', 'confirmed', 'attended', null, u_mario),
    (o_clinic, p_salas, s_limpieza, c_sofia, w[1], '11:00', 'pending', 'attended', null, u_mario),
    (o_clinic, p_salas, s_limpieza, c_ricardo, w[1], '17:00', 'pending', 'attended', null, u_mario),
    (o_indep, p_luis, s_primera, c_hector, w[1], '09:00', 'confirmed', 'attended', null, u_luis),
    (o_indep, p_luis, s_subsec, c_paty, w[1], '11:00', 'pending', 'attended', null, u_luis),
    (o_indep, p_luis, s_subsec, c_elena, w[1], '16:30', 'pending', 'attended', null, u_luis),
    (o_vet, p_soto, s_vet, c_andrea, w[1], '10:00', 'confirmed', 'attended', 'Firulais', u_mario),
    (o_vet, p_soto, s_vacuna, c_andrea, w[1], '10:30', 'pending', 'attended', 'Michi', u_mario),
    -- Siguientes días hábiles
    (o_clinic, p_ruiz, s_consulta, c_carlos, w[2], '09:00', 'pending', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_consulta, c_lupita, w[2], '12:30', 'confirmed', 'attended', null, u_mario),
    (o_clinic, p_ruiz, s_seguimiento, c_maria, w[2], '15:00', 'pending', 'attended', null, u_mario),
    (o_clinic, p_salas, s_valoracion, c_jose, w[2], '12:00', 'pending', 'attended', null, u_mario),
    (o_indep, p_luis, s_primera, c_paty, w[2], '08:00', 'pending', 'attended', null, u_luis),
    (o_vet, p_soto, s_vet, c_raul, w[2], '11:00', 'pending', 'attended', 'Rocky', u_mario),
    (o_clinic, p_ruiz, s_consulta, c_ricardo, w[3], '10:00', 'pending', 'attended', null, u_mario),
    (o_indep, p_luis, s_subsec, c_hector, w[4], '17:00', 'pending', 'attended', null, u_luis);

  insert into public.appointments
    (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status, pet_name, created_by)
  select a.org, a.prof, a.svc, a.contact,
         (a.day + a.at) at time zone tz,
         (a.day + a.at) at time zone tz + make_interval(mins => s.duration_minutes),
         case when (a.day + a.at) at time zone tz < now() then a.past_status else a.future_status end,
         a.pet, a.by_user
  from demo_appts a
  join public.services s on s.id = a.svc;

  -- Una cita cancelada y otra reprogramada, para mostrar el historial.
  insert into public.appointments
    (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status, created_by)
  values
    (o_clinic, p_ruiz, s_consulta, c_sofia, (w[2] + time '16:00') at time zone tz, (w[2] + time '16:30') at time zone tz, 'pending', u_mario)
  returning id into v_id;
  update public.appointments set status = 'cancelled', cancellation_reason = 'La paciente pidió cancelar', updated_by = u_mario
  where id = v_id;

  insert into public.appointments
    (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status, created_by)
  values
    (o_clinic, p_salas, s_valoracion, c_maria, (w[2] + time '16:00') at time zone tz, (w[2] + time '16:30') at time zone tz, 'pending', u_mario)
  returning id into v_id;
  update public.appointments set starts_at = (w[2] + time '17:30') at time zone tz, updated_by = u_mario
  where id = v_id;
end
$seed$;
