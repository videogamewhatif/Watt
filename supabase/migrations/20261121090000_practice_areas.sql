-- =============================================================================
-- Áreas de atención: Hospital, Nutriólogo, Psicólogo, Dentista, Óptica.
-- El tipo 'medico' conserva su código (referenciado por profesionales) y se
-- muestra como "Hospital".
-- =============================================================================
update public.professional_types set label = 'Hospital', sort_order = 10 where code = 'medico';
update public.professional_types set sort_order = 20 where code = 'nutriologo';
update public.professional_types set sort_order = 40 where code = 'dentista';

insert into public.professional_types (code, label, sort_order, uses_pet_name) values
  ('psicologo', 'Psicólogo', 30, false),
  ('optica', 'Óptica', 50, false)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

update public.professional_types set sort_order = 60 where code = 'veterinario';
