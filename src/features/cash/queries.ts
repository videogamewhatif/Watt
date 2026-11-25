import "server-only";
import type { CashMovementRow, CashSessionRow, CashSessionTotals, ChargeItemRow, ChargeRow, PaymentMethod, PaymentRow } from "@/lib/database.types";
import { logError } from "@/lib/errors";
import type { AppContext } from "@/lib/session";
import { todayIn } from "@/lib/tz";

export type ChargeListItem = ChargeRow & {
  contact_name: string | null;
  summary: string;
  methods: PaymentMethod[];
  created_by_name: string | null;
};

export type SessionView = {
  session: CashSessionRow;
  totals: CashSessionTotals;
  charges: ChargeListItem[];
  movements: (CashMovementRow & { created_by_name: string | null })[];
  openedByName: string | null;
  closedByName: string | null;
};

export type PosService = { id: string; name: string; price: number; durationMinutes: number };

export type Receivable = {
  appointmentId: string;
  localStart: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  professionalName: string;
  serviceId: string;
  serviceName: string;
  price: number;
  status: "pending" | "confirmed" | "attended";
};

const EMPTY_TOTALS: CashSessionTotals = {
  opening_amount: 0,
  cash_sales: 0,
  card_sales: 0,
  transfer_sales: 0,
  movements_in: 0,
  movements_out: 0,
  expected_cash: 0,
  charges_count: 0,
  voided_count: 0,
  voided_total: 0,
};

/** Normaliza lo que devuelve PostgREST para columnas numeric (puede llegar como texto). */
const num = (value: unknown) => Number(value ?? 0);

export function normalizeTotals(row: Partial<Record<keyof CashSessionTotals, unknown>> | null | undefined): CashSessionTotals {
  if (!row) return EMPTY_TOTALS;
  return Object.fromEntries(Object.keys(EMPTY_TOTALS).map((k) => [k, num(row[k as keyof CashSessionTotals])])) as CashSessionTotals;
}

function normalizeSession(row: CashSessionRow): CashSessionRow {
  return {
    ...row,
    opening_amount: num(row.opening_amount),
    counted_cash: row.counted_cash === null ? null : num(row.counted_cash),
    expected_cash: row.expected_cash === null ? null : num(row.expected_cash),
    difference: row.difference === null ? null : num(row.difference),
  };
}

/** Map.groupBy no existe en Node 20 (la app admite >= 20.9). */
function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of list) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

async function names(ctx: AppContext, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await ctx.supabase.from("profiles").select("id, full_name, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email || ""]));
}

export async function getOpenSession(ctx: AppContext): Promise<CashSessionRow | null> {
  const { data, error } = await ctx.supabase.from("cash_sessions").select("*").eq("organization_id", ctx.workspace.id).is("closed_at", null).maybeSingle();
  if (error) logError("open_session", error);
  return data ? normalizeSession(data) : null;
}

export async function getRecentSessions(ctx: AppContext, limit = 12): Promise<CashSessionRow[]> {
  const { data, error } = await ctx.supabase
    .from("cash_sessions")
    .select("*")
    .eq("organization_id", ctx.workspace.id)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(limit);
  if (error) logError("recent_sessions", error);
  return (data ?? []).map(normalizeSession);
}

export async function getSession(ctx: AppContext, id: string): Promise<CashSessionRow | null> {
  const { data } = await ctx.supabase.from("cash_sessions").select("*").eq("organization_id", ctx.workspace.id).eq("id", id).maybeSingle();
  return data ? normalizeSession(data) : null;
}

/** Agrega a cada cobro el paciente, el resumen de conceptos, las formas de pago y quién cobró. */
async function enrichCharges(ctx: AppContext, charges: ChargeRow[], extraUserIds: (string | null)[] = []) {
  const ids = charges.map((c) => c.id);
  const contactIds = [...new Set(charges.map((c) => c.contact_id).filter((id): id is string => Boolean(id)))];
  const [itemsRes, paymentsRes, contactsRes, userNames] = await Promise.all([
    ids.length ? ctx.supabase.from("charge_items").select("*").in("charge_id", ids).order("id") : { data: [] as ChargeItemRow[] },
    ids.length ? ctx.supabase.from("payments").select("*").in("charge_id", ids) : { data: [] as PaymentRow[] },
    contactIds.length ? ctx.supabase.from("contacts").select("id, full_name").in("id", contactIds) : { data: [] as { id: string; full_name: string }[] },
    names(ctx, [...charges.map((c) => c.created_by), ...extraUserIds]),
  ]);
  const contactName = new Map((contactsRes.data ?? []).map((c) => [c.id, c.full_name]));
  const items = groupBy(itemsRes.data ?? [], (i) => i.charge_id);
  const payments = groupBy(paymentsRes.data ?? [], (p) => p.charge_id);
  const list: ChargeListItem[] = charges.map((c) => ({
    ...c,
    subtotal: num(c.subtotal),
    discount: num(c.discount),
    total: num(c.total),
    contact_name: c.contact_id ? (contactName.get(c.contact_id) ?? null) : null,
    summary: (items.get(c.id) ?? []).map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.description}` : i.description)).join(", "),
    methods: [...new Set((payments.get(c.id) ?? []).map((p) => p.method))],
    created_by_name: c.created_by ? (userNames.get(c.created_by) ?? null) : null,
  }));
  return { list, userNames };
}

/** Cobros, movimientos y totales de un turno. */
export async function loadSession(ctx: AppContext, session: CashSessionRow): Promise<SessionView> {
  const [totals, chargesRes, movementsRes] = await Promise.all([
    ctx.supabase.rpc("cash_session_totals", { p_session_id: session.id }),
    ctx.supabase.from("charges").select("*").eq("session_id", session.id).order("folio", { ascending: false }),
    ctx.supabase.from("cash_movements").select("*").eq("session_id", session.id).order("created_at", { ascending: false }),
  ]);
  const movements = movementsRes.data ?? [];
  const { list, userNames } = await enrichCharges(ctx, chargesRes.data ?? [], [session.opened_by, session.closed_by, ...movements.map((m) => m.created_by)]);

  return {
    session,
    totals: normalizeTotals(totals.data?.[0]),
    charges: list,
    movements: movements.map((m) => ({ ...m, amount: num(m.amount), created_by_name: m.created_by ? (userNames.get(m.created_by) ?? null) : null })),
    openedByName: session.opened_by ? (userNames.get(session.opened_by) ?? null) : null,
    closedByName: session.closed_by ? (userNames.get(session.closed_by) ?? null) : null,
  };
}

/** Los cobros más recientes que registró la persona en este espacio. */
export async function getMyCharges(ctx: AppContext, limit = 100): Promise<ChargeListItem[]> {
  const { data, error } = await ctx.supabase
    .from("charges")
    .select("*")
    .eq("organization_id", ctx.workspace.id)
    .eq("created_by", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) logError("my_charges", error);
  return (await enrichCharges(ctx, data ?? [])).list;
}

/** Servicios activos con su precio, para armar el cobro. */
export async function getPosServices(ctx: AppContext): Promise<PosService[]> {
  const { data } = await ctx.supabase.from("services").select("id, name, price, duration_minutes").eq("organization_id", ctx.workspace.id).eq("active", true).order("name");
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, price: num(s.price), durationMinutes: s.duration_minutes }));
}

/** Citas de hoy (no canceladas) que todavía no tienen un cobro vigente. */
export async function getReceivables(ctx: AppContext): Promise<Receivable[]> {
  const today = todayIn(ctx.workspace.timezone);
  const { data: appts, error } = await ctx.supabase.rpc("agenda_appointments", {
    p_organization_id: ctx.workspace.id,
    p_from: today,
    p_to: today,
    p_statuses: ["pending", "confirmed", "attended"],
  });
  if (error) {
    logError("receivables", error);
    return [];
  }
  const list = appts ?? [];
  if (!list.length) return [];
  const [{ data: charged }, { data: services }] = await Promise.all([
    ctx.supabase.from("charges").select("appointment_id").in("appointment_id", list.map((a) => a.id)).eq("status", "paid"),
    ctx.supabase.from("services").select("id, price").eq("organization_id", ctx.workspace.id),
  ]);
  const done = new Set((charged ?? []).map((c) => c.appointment_id));
  const price = new Map((services ?? []).map((s) => [s.id, num(s.price)]));
  return list
    .filter((a) => !done.has(a.id))
    .map((a) => ({
      appointmentId: a.id,
      localStart: a.local_start,
      contactId: a.contact_id,
      contactName: a.contact_name,
      contactPhone: a.contact_phone,
      contactEmail: a.contact_email,
      professionalName: a.professional_name,
      serviceId: a.service_id,
      serviceName: a.service_name,
      price: price.get(a.service_id) ?? 0,
      status: a.status as Receivable["status"],
    }));
}

export type ChargeDetail = {
  charge: ChargeRow;
  items: ChargeItemRow[];
  payments: PaymentRow[];
  contactName: string | null;
  cashierName: string | null;
  voidedByName: string | null;
  sessionClosed: boolean;
};

export async function getChargeDetail(ctx: AppContext, id: string): Promise<ChargeDetail | null> {
  const { data: charge } = await ctx.supabase.from("charges").select("*").eq("organization_id", ctx.workspace.id).eq("id", id).maybeSingle();
  if (!charge) return null;
  const [{ data: items }, { data: payments }, contact, session, userNames] = await Promise.all([
    ctx.supabase.from("charge_items").select("*").eq("charge_id", id).order("id"),
    ctx.supabase.from("payments").select("*").eq("charge_id", id).order("created_at"),
    charge.contact_id ? ctx.supabase.from("contacts").select("full_name").eq("id", charge.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.supabase.from("cash_sessions").select("closed_at").eq("id", charge.session_id).maybeSingle(),
    names(ctx, [charge.created_by, charge.voided_by]),
  ]);
  return {
    charge: { ...charge, subtotal: num(charge.subtotal), discount: num(charge.discount), total: num(charge.total) },
    items: (items ?? []).map((i) => ({ ...i, unit_price: num(i.unit_price), amount: num(i.amount) })),
    payments: (payments ?? []).map((p) => ({ ...p, amount: num(p.amount) })),
    contactName: contact.data?.full_name ?? null,
    cashierName: charge.created_by ? (userNames.get(charge.created_by) ?? null) : null,
    voidedByName: charge.voided_by ? (userNames.get(charge.voided_by) ?? null) : null,
    sessionClosed: Boolean(session.data?.closed_at),
  };
}
