-- =============================================================================
-- Mi horario: el profesional con cuenta administra SU horario semanal y SUS
-- bloqueos (vacaciones, comida, ausencias). Administración sigue pudiendo
-- editar los de cualquiera. Recepción solo los consulta.
-- =============================================================================

-- Horario semanal ------------------------------------------------------------
drop policy availability_rules_insert on public.availability_rules;
drop policy availability_rules_update on public.availability_rules;
drop policy availability_rules_delete on public.availability_rules;

create policy availability_rules_insert on public.availability_rules for insert to authenticated
  with check (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy availability_rules_update on public.availability_rules for update to authenticated
  using (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  )
  with check (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy availability_rules_delete on public.availability_rules for delete to authenticated
  using (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  );

-- La regla y su profesional deben ser del mismo espacio (el profesional no
-- puede crear reglas a su nombre en otro espacio).
create function private.tg_availability_rules_same_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.professionals p where p.id = new.professional_id and p.organization_id = new.organization_id
  ) then
    raise exception using errcode = 'P0001', message = 'professional_not_found';
  end if;
  return new;
end;
$$;

create trigger availability_rules_same_org before insert or update on public.availability_rules
  for each row execute function private.tg_availability_rules_same_org();

create or replace function public.set_weekly_schedule(p_professional_id uuid, p_rules jsonb)
returns integer
language plpgsql volatile security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_outside integer;
begin
  select p.organization_id into v_org from public.professionals p where p.id = p_professional_id;
  if v_org is null
    or not (private.is_admin_of(v_org) or p_professional_id in (select private.own_professional_ids())) then
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

-- Bloqueos -------------------------------------------------------------------
drop policy time_off_insert on public.time_off;
drop policy time_off_update on public.time_off;
drop policy time_off_delete on public.time_off;

create policy time_off_insert on public.time_off for insert to authenticated
  with check (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy time_off_update on public.time_off for update to authenticated
  using (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  )
  with check (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  );
create policy time_off_delete on public.time_off for delete to authenticated
  using (
    organization_id in (select private.admin_org_ids())
    or professional_id in (select private.own_professional_ids())
  );

create or replace function private.tg_time_off_before_write()
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

  if v_uid is not null
    and new.organization_id not in (select private.admin_org_ids())
    and new.professional_id not in (select private.own_professional_ids()) then
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

-- Función de trigger nueva: sin ejecución directa para anon.
revoke execute on function private.tg_availability_rules_same_org() from public, anon;
grant execute on function private.tg_availability_rules_same_org() to authenticated, service_role;
