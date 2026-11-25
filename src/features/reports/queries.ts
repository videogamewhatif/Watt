import "server-only";
// Lectura de datos para los reportes. Todo se lee con la sesión de la persona:
// RLS decide qué filas obtiene cada rol (Profesional no lee la caja y solo ve sus
// citas). Las consultas se paginan porque PostgREST devuelve como máximo 1000
// filas por solicitud, y las búsquedas por id se hacen en lotes (la URL tiene límite).
import type { AppointmentStatus } from "@/lib/database.types";
import { logError } from "@/lib/errors";
import { toCents } from "@/lib/money";
import type { AppContext } from "@/lib/session";
import { addDays, zonedToInstant } from "@/lib/tz";
import { canViewReport, findReport, type ReportKey } from "./catalog";
import {
  type AppointmentIn,
  appointmentsReport,
  auditReport,
  cashClosingsReport,
  type ChargeIn,
  conceptsReport,
  type ContactIn,
  myActivityReport,
  type Names,
  type NewContactIn,
  type Period,
  type ProfessionalIn,
  patientsReport,
  professionalsReport,
  receivablesReport,
  type RuleIn,
  salesReport,
  type SessionIn,
  type TimeOffIn,
} from "./compute";
import type { LoadedReport, ReportResult } from "./model";
import type { ReportFilters } from "./params";

/** Filas por página: el `max_rows` por omisión de Supabase. */
const PAGE = 1000;
/** Tope de filas por consulta (un año de un espacio grande cabe de sobra). */
const MAX_ROWS = 25_000;
/** Ids por consulta `in (...)`. */
const CHUNK = 150;

type DbError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null;
type Res<T> = { data: T[] | null; error: DbError };
type Tracker = { error: boolean; truncated: boolean };

async function readAll<T>(t: Tracker, label: string, run: (from: number, to: number) => PromiseLike<Res<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    if (from >= MAX_ROWS) {
      t.truncated = true;
      break;
    }
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) {
      logError(`report_${label}`, error);
      t.error = true;
      break;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function readByIds<T>(t: Tracker, label: string, ids: (string | null)[], run: (chunk: string[], from: number, to: number) => PromiseLike<Res<T>>): Promise<T[]> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));
  const pages = await Promise.all(chunks.map((chunk) => readAll(t, label, (from, to) => run(chunk, from, to))));
  return pages.flat();
}

/** Instantes [desde, hasta) que cubren los días locales del periodo. */
export function instantRange(period: Period): { lo: string; hi: string } {
  return {
    lo: zonedToInstant(period.from, "00:00", period.timezone).toISOString(),
    hi: zonedToInstant(addDays(period.to, 1), "00:00", period.timezone).toISOString(),
  };
}

const num = (value: unknown) => Number(value ?? 0);
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------
const CHARGE_COLS = "id, folio, status, created_at, created_by, contact_id, appointment_id, session_id, subtotal, discount, total, voided_by, voided_at, void_reason";

function normalizeCharge(c: ChargeIn): ChargeIn {
  return { ...c, subtotal: num(c.subtotal), discount: num(c.discount), total: num(c.total) };
}

async function chargesCreatedIn(ctx: AppContext, t: Tracker, lo: string, hi: string): Promise<ChargeIn[]> {
  const rows = await readAll(t, "charges", (from, to) =>
    ctx.supabase.from("charges").select(CHARGE_COLS).eq("organization_id", ctx.workspace.id).gte("created_at", lo).lt("created_at", hi).order("id").range(from, to),
  );
  return rows.map(normalizeCharge);
}

async function chargesOfSessions(ctx: AppContext, t: Tracker, sessionIds: string[]): Promise<ChargeIn[]> {
  const rows = await readByIds(t, "session_charges", sessionIds, (chunk, from, to) =>
    ctx.supabase.from("charges").select(CHARGE_COLS).in("session_id", chunk).order("id").range(from, to),
  );
  return rows.map(normalizeCharge);
}

async function paidAppointmentIds(ctx: AppContext, t: Tracker, appointmentIds: string[]): Promise<Set<string>> {
  const rows = await readByIds(t, "charged_appointments", appointmentIds, (chunk, from, to) =>
    ctx.supabase.from("charges").select("id, appointment_id").in("appointment_id", chunk).eq("status", "paid").order("id").range(from, to),
  );
  return new Set(rows.map((r) => r.appointment_id).filter((id): id is string => Boolean(id)));
}

async function paymentsOf(ctx: AppContext, t: Tracker, column: "charge_id" | "session_id", ids: string[]) {
  const rows = await readByIds(t, "payments", ids, (chunk, from, to) =>
    ctx.supabase.from("payments").select("id, charge_id, session_id, method, amount").in(column, chunk).order("id").range(from, to),
  );
  return rows.map((p) => ({ ...p, amount: num(p.amount) }));
}

async function itemsOf(ctx: AppContext, t: Tracker, chargeIds: string[]) {
  const rows = await readByIds(t, "charge_items", chargeIds, (chunk, from, to) =>
    ctx.supabase.from("charge_items").select("id, charge_id, service_id, description, quantity, amount").in("charge_id", chunk).order("id").range(from, to),
  );
  return rows.map((i) => ({ ...i, amount: num(i.amount) }));
}

const APPOINTMENT_COLS = "id, professional_id, service_id, contact_id, status, starts_at, ends_at";

/**
 * Citas que empiezan en el periodo. `professionalIds` null = todas las visibles
 * (RLS ya limita al rol Profesional a las suyas).
 */
async function appointmentsIn(ctx: AppContext, t: Tracker, lo: string, hi: string, professionalIds: string[] | null, statuses?: AppointmentStatus[]): Promise<AppointmentIn[]> {
  const base = () => {
    let q = ctx.supabase.from("appointments").select(APPOINTMENT_COLS).eq("organization_id", ctx.workspace.id).gte("starts_at", lo).lt("starts_at", hi);
    if (statuses) q = q.in("status", statuses);
    return q;
  };
  if (professionalIds === null) return readAll(t, "appointments", (from, to) => base().order("id").range(from, to));
  return readByIds(t, "appointments", professionalIds, (chunk, from, to) => base().in("professional_id", chunk).order("id").range(from, to));
}

async function appointmentsById(ctx: AppContext, t: Tracker, ids: (string | null)[]): Promise<AppointmentIn[]> {
  return readByIds(t, "appointments_by_id", ids, (chunk, from, to) => ctx.supabase.from("appointments").select(APPOINTMENT_COLS).in("id", chunk).order("id").range(from, to));
}

async function professionalsOf(ctx: AppContext, t: Tracker): Promise<ProfessionalIn[]> {
  return readAll(t, "professionals", (from, to) =>
    ctx.supabase.from("professionals").select("id, display_name, professional_type, active").eq("organization_id", ctx.workspace.id).order("id").range(from, to),
  );
}

async function servicesOf(ctx: AppContext, t: Tracker): Promise<Map<string, { name: string; price: number }>> {
  const rows = await readAll(t, "services", (from, to) => ctx.supabase.from("services").select("id, name, price").eq("organization_id", ctx.workspace.id).order("id").range(from, to));
  return new Map(rows.map((s) => [s.id, { name: s.name, price: num(s.price) }]));
}

async function typeLabels(ctx: AppContext, t: Tracker): Promise<Names> {
  const { data, error } = await ctx.supabase.from("professional_types").select("code, label");
  if (error) {
    logError("report_types", error);
    t.error = true;
  }
  return new Map((data ?? []).map((r) => [r.code, r.label]));
}

async function userNames(ctx: AppContext, t: Tracker, ids: (string | null)[]): Promise<Names> {
  const rows = await readByIds(t, "profiles", ids, (chunk, from, to) => ctx.supabase.from("profiles").select("id, full_name, email").in("id", chunk).order("id").range(from, to));
  return new Map(rows.map((p) => [p.id, p.full_name || p.email || "Sin nombre"]));
}

async function contactsById(ctx: AppContext, t: Tracker, ids: (string | null)[]): Promise<Map<string, ContactIn>> {
  const rows = await readByIds(t, "contacts", ids, (chunk, from, to) => ctx.supabase.from("contacts").select("id, full_name, phone, email").in("id", chunk).order("id").range(from, to));
  return new Map(rows.map((c) => [c.id, c]));
}

async function rulesOf(ctx: AppContext, t: Tracker, professionalIds: string[]): Promise<RuleIn[]> {
  return readByIds(t, "rules", professionalIds, (chunk, from, to) =>
    ctx.supabase.from("availability_rules").select("id, professional_id, weekday, start_time, end_time").in("professional_id", chunk).order("id").range(from, to),
  );
}

async function timeOffOf(ctx: AppContext, t: Tracker, professionalIds: string[], lo: string, hi: string): Promise<TimeOffIn[]> {
  return readByIds(t, "time_off", professionalIds, (chunk, from, to) =>
    ctx.supabase.from("time_off").select("id, professional_id, starts_at, ends_at").in("professional_id", chunk).lt("starts_at", hi).gt("ends_at", lo).order("id").range(from, to),
  );
}

// ---------------------------------------------------------------------------
// Alcance por área y profesional
// ---------------------------------------------------------------------------
/** Profesionales que entran en el reporte según los filtros (todos los visibles si no hay filtro). */
function scope(professionals: ProfessionalIn[], filters: Pick<ReportFilters, "area" | "professionalId">): ProfessionalIn[] {
  return professionals.filter((p) => (!filters.area || p.professional_type === filters.area) && (!filters.professionalId || p.id === filters.professionalId));
}

/** Ids para filtrar citas; null cuando no hay filtro (se leen todas las visibles). */
function scopeIds(professionals: ProfessionalIn[], filters: Pick<ReportFilters, "area" | "professionalId">): string[] | null {
  return filters.area || filters.professionalId ? scope(professionals, filters).map((p) => p.id) : null;
}

/** Profesionales para el selector del filtro (visibles para la persona). */
export async function reportProfessionalOptions(ctx: AppContext): Promise<{ id: string; name: string; type: string; active: boolean }[]> {
  const t: Tracker = { error: false, truncated: false };
  const rows = await professionalsOf(ctx, t);
  return rows
    .map((p) => ({ id: p.id, name: p.display_name, type: p.professional_type, active: p.active }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es"));
}

// ---------------------------------------------------------------------------
// Cada reporte
// ---------------------------------------------------------------------------
type Input = { ctx: AppContext; t: Tracker; period: Period; filters: ReportFilters; lo: string; hi: string };

async function sales({ ctx, t, period, lo, hi }: Input): Promise<ReportResult> {
  const charges = await chargesCreatedIn(ctx, t, lo, hi);
  const [payments, names] = await Promise.all([
    paymentsOf(
      ctx,
      t,
      "charge_id",
      charges.filter((c) => c.status === "paid").map((c) => c.id),
    ),
    userNames(ctx, t, charges.map((c) => c.created_by)),
  ]);
  return salesReport({ period, charges, payments, names });
}

async function concepts({ ctx, t, lo, hi }: Input): Promise<ReportResult> {
  const charges = await chargesCreatedIn(ctx, t, lo, hi);
  const [items, services] = await Promise.all([
    itemsOf(
      ctx,
      t,
      charges.filter((c) => c.status === "paid").map((c) => c.id),
    ),
    servicesOf(ctx, t),
  ]);
  return conceptsReport({ charges, items, serviceNames: new Map([...services].map(([id, s]) => [id, s.name])) });
}

async function closings({ ctx, t, period, lo, hi }: Input): Promise<ReportResult> {
  const raw = await readAll(t, "cash_sessions", (from, to) =>
    ctx.supabase.from("cash_sessions").select("*").eq("organization_id", ctx.workspace.id).gte("opened_at", lo).lt("opened_at", hi).order("id").range(from, to),
  );
  const sessions: SessionIn[] = raw.map((s) => ({
    id: s.id,
    opened_at: s.opened_at,
    opened_by: s.opened_by,
    closed_at: s.closed_at,
    closed_by: s.closed_by,
    opening_amount: num(s.opening_amount),
    counted_cash: numOrNull(s.counted_cash),
    expected_cash: numOrNull(s.expected_cash),
    difference: numOrNull(s.difference),
  }));
  const ids = sessions.map((s) => s.id);
  const [charges, payments, movementRows] = await Promise.all([
    chargesOfSessions(ctx, t, ids),
    paymentsOf(ctx, t, "session_id", ids),
    readByIds(t, "cash_movements", ids, (chunk, from, to) =>
      ctx.supabase.from("cash_movements").select("id, session_id, kind, amount, concept, created_at, created_by").in("session_id", chunk).order("id").range(from, to),
    ),
  ]);
  const movements = movementRows.map((m) => ({ ...m, amount: num(m.amount) }));
  const names = await userNames(ctx, t, [...sessions.flatMap((s) => [s.opened_by, s.closed_by]), ...movements.map((m) => m.created_by)]);
  return cashClosingsReport({ period, sessions, charges, payments, movements, names });
}

async function audit({ ctx, t, period, lo, hi }: Input): Promise<ReportResult> {
  const charges = await chargesCreatedIn(ctx, t, lo, hi);
  const flagged = charges.filter((c) => c.status === "voided" || c.discount > 0);
  const [names, contacts] = await Promise.all([
    userNames(ctx, t, [...charges.map((c) => c.created_by), ...flagged.map((c) => c.voided_by)]),
    contactsById(ctx, t, flagged.map((c) => c.contact_id)),
  ]);
  return auditReport({ period, charges, names, contactNames: new Map([...contacts].map(([id, c]) => [id, c.full_name])) });
}

async function appointments({ ctx, t, period, filters, lo, hi }: Input): Promise<ReportResult> {
  const professionals = await professionalsOf(ctx, t);
  const [list, services] = await Promise.all([appointmentsIn(ctx, t, lo, hi, scopeIds(professionals, filters)), servicesOf(ctx, t)]);
  return appointmentsReport({ period, appointments: list, serviceNames: new Map([...services].map(([id, s]) => [id, s.name])), now: new Date() });
}

async function professionals({ ctx, t, period, filters, lo, hi }: Input): Promise<ReportResult> {
  const all = await professionalsOf(ctx, t);
  const chosen = scope(all, filters);
  const ids = chosen.map((p) => p.id);
  const [list, rules, timeOff, labels] = await Promise.all([
    appointmentsIn(ctx, t, lo, hi, ids),
    rulesOf(ctx, t, ids),
    timeOffOf(ctx, t, ids, lo, hi),
    typeLabels(ctx, t),
  ]);

  // Ingresos (solo Administración): cobros vigentes del periodo ligados a una cita.
  let revenue: Map<string, number> | null = null;
  let unattributedCents = 0;
  if (ctx.can.financialReports) {
    const charges = (await chargesCreatedIn(ctx, t, lo, hi)).filter((c) => c.status === "paid");
    const linked = await appointmentsById(ctx, t, charges.map((c) => c.appointment_id));
    const owner = new Map(linked.map((a) => [a.id, a.professional_id]));
    revenue = new Map();
    for (const c of charges) {
      const professional = c.appointment_id ? owner.get(c.appointment_id) : undefined;
      if (professional) revenue.set(professional, (revenue.get(professional) ?? 0) + toCents(c.total));
      else unattributedCents += toCents(c.total);
    }
  }
  return professionalsReport({ period, professionals: chosen, rules, timeOff, appointments: list, typeLabels: labels, revenue, unattributedCents });
}

async function patients({ ctx, t, period, filters, lo, hi }: Input): Promise<ReportResult> {
  const all = await professionalsOf(ctx, t);
  const scopeList = scopeIds(all, filters);
  const [list, newRows] = await Promise.all([
    appointmentsIn(ctx, t, lo, hi, scopeList),
    readAll(t, "new_contacts", (from, to) =>
      ctx.supabase.from("contacts").select("id, full_name, created_at, created_by").eq("organization_id", ctx.workspace.id).gte("created_at", lo).lt("created_at", hi).order("id").range(from, to),
    ),
  ]);
  const newContacts: NewContactIn[] = newRows;
  const attendedIds = [...new Set(list.filter((a) => a.status === "attended").map((a) => a.contact_id))];

  const [contacts, before, names, spend] = await Promise.all([
    contactsById(ctx, t, list.map((a) => a.contact_id)),
    // ¿Ya tenían una cita atendida antes del periodo? (en cualquier área o profesional)
    readByIds(t, "attended_before", attendedIds, (chunk, from, to) =>
      ctx.supabase.from("appointments").select("id, contact_id").in("contact_id", chunk).eq("status", "attended").lt("starts_at", lo).order("id").range(from, to),
    ),
    userNames(ctx, t, newContacts.map((c) => c.created_by)),
    ctx.can.financialReports ? chargesCreatedIn(ctx, t, lo, hi) : Promise.resolve(null),
  ]);

  let spendBy: Map<string, number> | null = null;
  if (spend) {
    spendBy = new Map();
    for (const c of spend) if (c.status === "paid" && c.contact_id) spendBy.set(c.contact_id, (spendBy.get(c.contact_id) ?? 0) + toCents(c.total));
  }
  return patientsReport({ period, appointments: list, contacts, attendedBefore: new Set(before.map((a) => a.contact_id)), newContacts, names, spend: spendBy });
}

async function receivables({ ctx, t, period, filters, lo, hi }: Input): Promise<ReportResult> {
  const all = await professionalsOf(ctx, t);
  const [list, services] = await Promise.all([appointmentsIn(ctx, t, lo, hi, scopeIds(all, filters), ["attended"]), servicesOf(ctx, t)]);
  const [charged, contacts] = await Promise.all([
    paidAppointmentIds(
      ctx,
      t,
      list.map((a) => a.id),
    ),
    contactsById(ctx, t, list.map((a) => a.contact_id)),
  ]);
  return receivablesReport({
    period,
    appointments: list,
    charged,
    services,
    professionalNames: new Map(all.map((p) => [p.id, p.display_name])),
    contactNames: new Map([...contacts].map(([id, c]) => [id, c.full_name])),
  });
}

async function myActivity({ ctx, t, period, lo, hi }: Input): Promise<ReportResult> {
  const own = ctx.ownProfessionalId;
  if (!own) return { kpis: [], charts: [], tables: [], notes: [] };
  const [list, rules, timeOff, services] = await Promise.all([
    appointmentsIn(ctx, t, lo, hi, [own]),
    rulesOf(ctx, t, [own]),
    timeOffOf(ctx, t, [own], lo, hi),
    servicesOf(ctx, t),
  ]);
  return myActivityReport({ period, appointments: list, rules, timeOff, serviceNames: new Map([...services].map(([id, s]) => [id, s.name])) });
}

const LOADERS: Record<ReportKey, (input: Input) => Promise<ReportResult>> = {
  ventas: sales,
  "ingresos-por-concepto": concepts,
  "cortes-de-caja": closings,
  "cancelaciones-y-descuentos": audit,
  citas: appointments,
  profesionales: professionals,
  pacientes: patients,
  "citas-por-cobrar": receivables,
  "mi-actividad": myActivity,
};

/**
 * Calcula un reporte para el espacio activo. Devuelve null si la persona no
 * tiene acceso a ese reporte (la página responde 404).
 */
export async function loadReport(ctx: AppContext, key: string, filters: ReportFilters): Promise<LoadedReport | null> {
  const def = findReport(key);
  if (!def || !canViewReport(def, ctx)) return null;
  const t: Tracker = { error: false, truncated: false };
  const period: Period = { from: filters.from, to: filters.to, timezone: ctx.workspace.timezone };
  const { lo, hi } = instantRange(period);
  const result = await LOADERS[def.key]({ ctx, t, period, filters, lo, hi });
  return { ...result, error: t.error, truncated: t.truncated };
}
