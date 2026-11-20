// Datos FICTICIOS del modo de prueba (los mismos de supabase/seed.sql), con fechas
// calculadas a partir de hoy en la zona del espacio.
import { addDays, isoWeekday, todayIn, zonedToInstant } from "@/lib/tz";
import { DEMO_PERSONAS } from "./personas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export type DemoStore = Record<
  | "profiles"
  | "organizations"
  | "memberships"
  | "invitations"
  | "professional_types"
  | "professionals"
  | "services"
  | "professional_services"
  | "availability_rules"
  | "time_off"
  | "contacts"
  | "appointments"
  | "appointment_events",
  Row[]
> & { seq: number };

const TZ = "America/Mexico_City";
const [U_LAURA, U_MARIO, U_ANA, U_LUIS] = DEMO_PERSONAS.map((p) => p.id);
const O_CLINIC = "b0000000-0000-4000-8000-000000000001";
const O_INDEP = "b0000000-0000-4000-8000-000000000002";
const O_VET = "b0000000-0000-4000-8000-000000000003";
const P_RUIZ = "c0000000-0000-4000-8000-000000000001";
const P_SALAS = "c0000000-0000-4000-8000-000000000002";
const P_LUIS = "c0000000-0000-4000-8000-000000000003";
const P_SOTO = "c0000000-0000-4000-8000-000000000004";

export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function phoneDigits(value: string | null | undefined): string | null {
  const d = (value ?? "").replace(/\D/g, "");
  return d || null;
}

export function contactComputed(row: Row): Row {
  return { ...row, search_name: normalizeSearch(row.full_name), phone_digits: phoneDigits(row.phone) };
}

export function buildDemoStore(now = new Date()): DemoStore {
  const iso = now.toISOString();
  const stamp = { created_at: iso, updated_at: iso };
  const today = todayIn(TZ, now);
  const w: string[] = [];
  for (let d = today; w.length < 6; d = addDays(d, 1)) if (isoWeekday(d) <= 5) w.push(d);
  let past1 = addDays(today, -1);
  while (isoWeekday(past1) > 5) past1 = addDays(past1, -1);
  const at = (day: string, time: string) => zonedToInstant(day, time, TZ).toISOString();

  const store: DemoStore = {
    seq: 0,
    profiles: DEMO_PERSONAS.map((p) => ({ id: p.id, full_name: p.name, email: p.email, ...stamp })),
    organizations: [
      { id: O_CLINIC, name: "Clínica Arboleda (demo)", kind: "clinic", timezone: TZ, slot_interval_minutes: 15, created_by: U_LAURA, ...stamp },
      { id: O_INDEP, name: "Consultorio Dr. Herrera (demo)", kind: "independent", timezone: TZ, slot_interval_minutes: 15, created_by: U_LUIS, ...stamp },
      { id: O_VET, name: "Veterinaria Patitas (demo)", kind: "clinic", timezone: TZ, slot_interval_minutes: 15, created_by: U_MARIO, ...stamp },
    ],
    memberships: [
      [O_CLINIC, U_LAURA, "admin"],
      [O_CLINIC, U_MARIO, "reception"],
      [O_CLINIC, U_ANA, "professional"],
      [O_INDEP, U_LUIS, "admin"],
      [O_VET, U_MARIO, "admin"],
    ].map(([organization_id, user_id, role], i) => ({
      id: `f0000000-0000-4000-8000-00000000000${i + 1}`,
      organization_id,
      user_id,
      role,
      ...stamp,
    })),
    invitations: [],
    professional_types: [
      { code: "medico", label: "Médico", sort_order: 10, uses_pet_name: false, active: true },
      { code: "dentista", label: "Dentista", sort_order: 20, uses_pet_name: false, active: true },
      { code: "nutriologo", label: "Nutriólogo", sort_order: 30, uses_pet_name: false, active: true },
      { code: "veterinario", label: "Veterinario", sort_order: 40, uses_pet_name: true, active: true },
      { code: "otro", label: "Otro", sort_order: 90, uses_pet_name: false, active: true },
    ],
    professionals: [
      [P_RUIZ, O_CLINIC, U_ANA, "Dra. Ana Ruiz", "medico", "Medicina general", "#0f766e", null],
      [P_SALAS, O_CLINIC, null, "Dr. Jorge Salas", "dentista", "Odontología general", "#7c3aed", "55 5010 2030"],
      [P_LUIS, O_INDEP, U_LUIS, "Dr. Luis Herrera", "medico", "Medicina interna", "#b45309", null],
      [P_SOTO, O_VET, null, "MVZ Daniela Soto", "veterinario", "Pequeñas especies", "#be185d", null],
    ].map(([id, organization_id, user_id, display_name, professional_type, specialty, color, phone]) => ({
      id,
      organization_id,
      user_id,
      display_name,
      professional_type,
      specialty,
      color,
      email: null,
      phone,
      active: true,
      deactivated_at: null,
      ...stamp,
    })),
    services: [
      ["d0000000-0000-4000-8000-000000000001", O_CLINIC, "Consulta general", 30, null],
      ["d0000000-0000-4000-8000-000000000002", O_CLINIC, "Revisión de seguimiento", 20, "Cita breve de control."],
      ["d0000000-0000-4000-8000-000000000003", O_CLINIC, "Valoración dental", 30, null],
      ["d0000000-0000-4000-8000-000000000004", O_CLINIC, "Limpieza dental", 45, null],
      ["d0000000-0000-4000-8000-000000000005", O_INDEP, "Consulta de primera vez", 45, null],
      ["d0000000-0000-4000-8000-000000000006", O_INDEP, "Consulta subsecuente", 30, null],
      ["d0000000-0000-4000-8000-000000000007", O_VET, "Consulta veterinaria", 30, null],
      ["d0000000-0000-4000-8000-000000000008", O_VET, "Vacunación", 15, null],
    ].map(([id, organization_id, name, duration_minutes, description]) => ({
      id,
      organization_id,
      name,
      duration_minutes,
      description,
      active: true,
      ...stamp,
    })),
    professional_services: [],
    availability_rules: [],
    time_off: [],
    contacts: [],
    appointments: [],
    appointment_events: [],
  };

  const S = Object.fromEntries(store.services.map((s) => [s.name, s]));
  const assign = (org: string, prof: string, names: string[]) =>
    names.forEach((n) => store.professional_services.push({ organization_id: org, professional_id: prof, service_id: S[n].id, created_at: iso }));
  assign(O_CLINIC, P_RUIZ, ["Consulta general", "Revisión de seguimiento"]);
  assign(O_CLINIC, P_SALAS, ["Valoración dental", "Limpieza dental"]);
  assign(O_INDEP, P_LUIS, ["Consulta de primera vez", "Consulta subsecuente"]);
  assign(O_VET, P_SOTO, ["Consulta veterinaria", "Vacunación"]);

  let ruleN = 0;
  const rule = (org: string, prof: string, days: number[], blocks: [string, string][]) => {
    for (const weekday of days)
      for (const [start_time, end_time] of blocks)
        store.availability_rules.push({
          id: `e1000000-0000-4000-8000-${String(++ruleN).padStart(12, "0")}`,
          organization_id: org,
          professional_id: prof,
          weekday,
          start_time: `${start_time}:00`,
          end_time: `${end_time}:00`,
          created_at: iso,
        });
  };
  rule(O_CLINIC, P_RUIZ, [1, 2, 3, 4, 5], [["09:00", "13:00"], ["15:00", "18:00"]]);
  rule(O_CLINIC, P_SALAS, [1, 2, 3, 4, 5], [["10:00", "14:00"], ["16:00", "19:00"]]);
  rule(O_CLINIC, P_SALAS, [6], [["09:00", "13:00"]]);
  rule(O_INDEP, P_LUIS, [1, 2, 3, 4, 5], [["08:00", "12:00"], ["16:00", "19:00"]]);
  rule(O_VET, P_SOTO, [1, 2, 3, 4, 5, 6], [["10:00", "15:00"]]);

  const contacts: [string, string, string, string | null, string | null, string][] = [
    ["maria", O_CLINIC, "María Fernanda López", "55 1234 0001", null, U_MARIO],
    ["jose", O_CLINIC, "José Ramírez Torres", "55 1234 0002", "jose.ramirez@correo.test", U_MARIO],
    ["lupita", O_CLINIC, "Guadalupe Sánchez", null, "lupita.sanchez@correo.test", U_MARIO],
    ["carlos", O_CLINIC, "Carlos Medina", "55 1234 0004", null, U_MARIO],
    ["sofia", O_CLINIC, "Sofía Castillo", "55 1234 0005", null, U_LAURA],
    ["ricardo", O_CLINIC, "Ricardo Núñez", "55 1234 0006", null, U_MARIO],
    ["elena", O_INDEP, "Elena Vargas", "33 2000 0001", null, U_LUIS],
    ["hector", O_INDEP, "Héctor Morales", "33 2000 0002", "hector.morales@correo.test", U_LUIS],
    ["paty", O_INDEP, "Patricia Ríos", null, "paty.rios@correo.test", U_LUIS],
    ["andrea", O_VET, "Andrea Flores", "55 3000 0001", null, U_MARIO],
    ["raul", O_VET, "Raúl Domínguez", "55 3000 0002", null, U_MARIO],
  ];
  const C: Record<string, string> = {};
  contacts.forEach(([key, organization_id, full_name, phone, email, created_by], i) => {
    const id = `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    C[key] = id;
    store.contacts.push(contactComputed({ id, organization_id, full_name, phone, email, created_by, ...stamp }));
  });

  const block = (org: string, prof: string, starts: string, ends: string, kind: string, note: string, by: string) =>
    store.time_off.push({
      id: crypto.randomUUID(),
      organization_id: org,
      professional_id: prof,
      starts_at: starts,
      ends_at: ends,
      kind,
      note,
      created_by: by,
      ...stamp,
    });
  block(O_CLINIC, P_RUIZ, at(w[1], "11:00"), at(w[1], "12:00"), "absence", "Junta clínica", U_LAURA);
  block(O_CLINIC, P_SALAS, at(w[2], "00:00"), at(addDays(w[2], 1), "00:00"), "vacation", "Vacaciones", U_LAURA);
  block(O_INDEP, P_LUIS, at(w[2], "08:00"), at(w[2], "10:00"), "absence", "Congreso", U_LUIS);

  const event = (a: Row, type: string, extra: Row = {}) =>
    store.appointment_events.push({
      id: ++store.seq,
      organization_id: a.organization_id,
      appointment_id: a.id,
      event_type: type,
      actor_id: a.created_by,
      from_status: null,
      to_status: null,
      from_starts_at: null,
      from_ends_at: null,
      to_starts_at: null,
      to_ends_at: null,
      from_professional_id: null,
      to_professional_id: null,
      created_at: iso,
      ...extra,
    });

  const appt = (org: string, prof: string, service: string, contact: string, day: string, time: string, future: string, past: string, pet: string | null, by: string) => {
    const starts = at(day, time);
    const ends = new Date(new Date(starts).getTime() + S[service].duration_minutes * 60000).toISOString();
    const row: Row = {
      id: crypto.randomUUID(),
      organization_id: org,
      professional_id: prof,
      service_id: S[service].id,
      contact_id: C[contact],
      pet_name: pet,
      starts_at: starts,
      ends_at: ends,
      status: new Date(starts) < now ? past : future,
      notes: null,
      cancellation_reason: null,
      idempotency_key: null,
      created_by: by,
      updated_by: by,
      status_changed_at: iso,
      ...stamp,
    };
    store.appointments.push(row);
    event(row, "created", { to_status: row.status, to_starts_at: starts, to_ends_at: ends, to_professional_id: prof });
    return row;
  };

  const CG = "Consulta general";
  const RS = "Revisión de seguimiento";
  const VD = "Valoración dental";
  const LD = "Limpieza dental";
  appt(O_CLINIC, P_RUIZ, CG, "maria", past1, "09:00", "confirmed", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, RS, "carlos", past1, "10:00", "confirmed", "no_show", null, U_MARIO);
  appt(O_CLINIC, P_SALAS, LD, "jose", past1, "10:30", "confirmed", "attended", null, U_MARIO);
  appt(O_INDEP, P_LUIS, "Consulta subsecuente", "elena", past1, "08:30", "confirmed", "attended", null, U_LUIS);
  appt(O_CLINIC, P_RUIZ, CG, "lupita", w[0], "09:00", "confirmed", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, RS, "sofia", w[0], "09:30", "pending", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, CG, "ricardo", w[0], "10:30", "confirmed", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, CG, "jose", w[0], "12:00", "pending", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, CG, "maria", w[0], "16:00", "pending", "attended", null, U_MARIO);
  appt(O_CLINIC, P_SALAS, VD, "carlos", w[0], "10:00", "confirmed", "attended", null, U_MARIO);
  appt(O_CLINIC, P_SALAS, LD, "sofia", w[0], "11:00", "pending", "attended", null, U_MARIO);
  appt(O_CLINIC, P_SALAS, LD, "ricardo", w[0], "17:00", "pending", "attended", null, U_MARIO);
  appt(O_INDEP, P_LUIS, "Consulta de primera vez", "hector", w[0], "09:00", "confirmed", "attended", null, U_LUIS);
  appt(O_INDEP, P_LUIS, "Consulta subsecuente", "paty", w[0], "11:00", "pending", "attended", null, U_LUIS);
  appt(O_INDEP, P_LUIS, "Consulta subsecuente", "elena", w[0], "16:30", "pending", "attended", null, U_LUIS);
  appt(O_VET, P_SOTO, "Consulta veterinaria", "andrea", w[0], "10:00", "confirmed", "attended", "Firulais", U_MARIO);
  appt(O_VET, P_SOTO, "Vacunación", "andrea", w[0], "10:30", "pending", "attended", "Michi", U_MARIO);
  appt(O_CLINIC, P_RUIZ, CG, "carlos", w[1], "09:00", "pending", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, CG, "lupita", w[1], "12:30", "confirmed", "attended", null, U_MARIO);
  appt(O_CLINIC, P_RUIZ, RS, "maria", w[1], "15:00", "pending", "attended", null, U_MARIO);
  appt(O_CLINIC, P_SALAS, VD, "jose", w[1], "12:00", "pending", "attended", null, U_MARIO);
  appt(O_INDEP, P_LUIS, "Consulta de primera vez", "paty", w[1], "08:00", "pending", "attended", null, U_LUIS);
  appt(O_VET, P_SOTO, "Consulta veterinaria", "raul", w[1], "11:00", "pending", "attended", "Rocky", U_MARIO);
  appt(O_CLINIC, P_RUIZ, CG, "ricardo", w[2], "10:00", "pending", "attended", null, U_MARIO);
  appt(O_INDEP, P_LUIS, "Consulta subsecuente", "hector", w[3], "17:00", "pending", "attended", null, U_LUIS);

  // Una cancelada y una reprogramada, para ver el historial.
  const cancelled = appt(O_CLINIC, P_RUIZ, CG, "sofia", w[1], "16:00", "pending", "pending", null, U_MARIO);
  cancelled.status = "cancelled";
  cancelled.cancellation_reason = "La paciente pidió cancelar";
  event(cancelled, "status_changed", { from_status: "pending", to_status: "cancelled" });
  const moved = appt(O_CLINIC, P_SALAS, VD, "maria", w[1], "16:00", "pending", "pending", null, U_MARIO);
  const newStart = at(w[1], "17:30");
  const newEnd = new Date(new Date(newStart).getTime() + 30 * 60000).toISOString();
  event(moved, "rescheduled", {
    from_starts_at: moved.starts_at,
    from_ends_at: moved.ends_at,
    to_starts_at: newStart,
    to_ends_at: newEnd,
    from_professional_id: P_SALAS,
    to_professional_id: P_SALAS,
  });
  moved.starts_at = newStart;
  moved.ends_at = newEnd;

  return store;
}

const globalForDemo = globalThis as unknown as { __wattalisDemo?: DemoStore };

/** Almacén en memoria del proceso. Se reinicia al reiniciar el servidor o con «Reiniciar datos». */
export function getDemoStore(): DemoStore {
  globalForDemo.__wattalisDemo ??= buildDemoStore();
  return globalForDemo.__wattalisDemo;
}

export function resetDemoStore() {
  globalForDemo.__wattalisDemo = buildDemoStore();
}
