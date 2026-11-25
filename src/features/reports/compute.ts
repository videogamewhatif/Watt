// Cálculo de los reportes a partir de filas ya leídas (con RLS). Son funciones
// puras: no consultan nada, no dependen de la zona del servidor y se prueban en
// tests/unit/reports.test.ts. El dinero se acumula en centavos enteros.
import type { AppointmentStatus, CashMovementKind, ChargeStatus, PaymentMethod } from "@/lib/database.types";
import { STATUS_LABEL, WEEKDAYS } from "@/lib/labels";
import { formatMoney, fromCents, PAYMENT_LABEL, PAYMENT_METHODS, toCents } from "@/lib/money";
import { eachDay, isoWeekday, localParts, type LocalDate, zonedToInstant } from "@/lib/tz";
import { formatCell } from "./format";
import type { Cell, Chart, ChartPoint, Column, Kpi, ReportResult, ReportTable, TableRow } from "./model";
import { bucketLabel, bucketOf, bucketsBetween, GRANULARITY_LABEL, type Granularity, granularityFor } from "./params";

// ---------------------------------------------------------------------------
// Filas de entrada (normalizadas: importes como número)
// ---------------------------------------------------------------------------
export type Period = { from: LocalDate; to: LocalDate; timezone: string };

export type ChargeIn = {
  id: string;
  folio: number;
  status: ChargeStatus;
  created_at: string;
  created_by: string | null;
  contact_id: string | null;
  appointment_id: string | null;
  session_id: string;
  subtotal: number;
  discount: number;
  total: number;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
};
export type PaymentIn = { charge_id: string; session_id: string; method: PaymentMethod; amount: number };
export type ItemIn = { charge_id: string; service_id: string | null; description: string; quantity: number; amount: number };
export type AppointmentIn = {
  id: string;
  professional_id: string;
  service_id: string;
  contact_id: string;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
};
export type ProfessionalIn = { id: string; display_name: string; professional_type: string; active: boolean };
export type RuleIn = { professional_id: string; weekday: number; start_time: string; end_time: string };
export type TimeOffIn = { professional_id: string; starts_at: string; ends_at: string };
export type SessionIn = {
  id: string;
  opened_at: string;
  opened_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  opening_amount: number;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
};
export type MovementIn = { session_id: string; kind: CashMovementKind; amount: number; concept: string; created_at: string; created_by: string | null };
export type ContactIn = { id: string; full_name: string; phone: string | null; email: string | null };
export type NewContactIn = { id: string; full_name: string; created_at: string; created_by: string | null };

/** Nombres por id (personas usuarias, pacientes, servicios, profesionales). */
export type Names = Map<string, string>;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const NO_NAME = "Sin nombre";
const nameOf = (names: Names, id: string | null | undefined, fallback = NO_NAME) => (id ? (names.get(id) ?? fallback) : fallback);

/** Fecha y hora locales: "YYYY-MM-DDTHH:MM". */
export function localStamp(iso: string, timezone: string): string {
  const p = localParts(iso, timezone);
  return `${p.date}T${p.time}`;
}
const localDate = (iso: string, timezone: string) => localParts(iso, timezone).date;

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Minutos → horas con un decimal. */
export const hours = (minutes: number) => Math.round(minutes / 6) / 10;

const money = (cents: number) => fromCents(cents);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function sumBy<T>(list: T[], value: (item: T) => number) {
  return list.reduce((n, item) => n + value(item), 0);
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    const group = out.get(k);
    if (group) group.push(item);
    else out.set(k, [item]);
  }
  return out;
}

type Timeline<T> = { granularity: Granularity; buckets: LocalDate[]; groups: Map<string, T[]> };

function timeline<T>(period: Period, items: T[], dateOf: (item: T) => LocalDate): Timeline<T> {
  const granularity = granularityFor(period.from, period.to);
  return {
    granularity,
    buckets: bucketsBetween(period.from, period.to, granularity),
    groups: groupBy(items, (item) => bucketOf(dateOf(item), granularity)),
  };
}

/** Primera columna de las tablas por periodo, según la agrupación. */
function periodColumn(granularity: Granularity): Column {
  if (granularity === "day") return { key: "periodo", label: "Fecha", format: "date" };
  if (granularity === "week") return { key: "periodo", label: "Semana del", format: "date" };
  return { key: "periodo", label: "Mes", format: "month" };
}

// ---------------------------------------------------------------------------
// Citas: conteo por estado
// ---------------------------------------------------------------------------
type StatusCount = Record<AppointmentStatus, number>;

export function countStatuses(appointments: Pick<AppointmentIn, "status">[]): StatusCount {
  const out: StatusCount = { pending: 0, confirmed: 0, attended: 0, cancelled: 0, no_show: 0 };
  for (const a of appointments) out[a.status] += 1;
  return out;
}

/** Citas que ocuparon o siguen ocupando un espacio en la agenda (todo menos canceladas). */
const scheduled = (c: StatusCount) => c.pending + c.confirmed + c.attended + c.no_show;
/** Asistencia: atendidas entre las que ya se resolvieron (atendidas + no asistió). */
const attendance = (c: StatusCount) => ratio(c.attended, c.attended + c.no_show);

const minutesOf = (a: Pick<AppointmentIn, "starts_at" | "ends_at">) => (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000;

// ---------------------------------------------------------------------------
// Ocupación: horario semanal vigente − bloqueos, contra la duración de las citas
// ---------------------------------------------------------------------------
type Interval = [number, number];

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Minutos disponibles de un profesional en el periodo (bloqueos ya descontados). */
export function availableMinutes(period: Period, rules: RuleIn[], timeOff: TimeOffIn[]): number {
  const blocks = mergeIntervals(timeOff.map((t) => [Date.parse(t.starts_at), Date.parse(t.ends_at)]));
  let total = 0;
  for (const day of eachDay(period.from, period.to)) {
    const weekday = isoWeekday(day);
    for (const r of rules) {
      if (r.weekday !== weekday) continue;
      const s = zonedToInstant(day, r.start_time.slice(0, 5), period.timezone).getTime();
      const e = zonedToInstant(day, r.end_time.slice(0, 5), period.timezone).getTime();
      if (e <= s) continue;
      const blocked = sumBy(blocks, ([bs, be]) => Math.max(0, Math.min(e, be) - Math.max(s, bs)));
      total += (e - s - blocked) / 60_000;
    }
  }
  return total;
}

export type Occupancy = { availableMinutes: number; bookedMinutes: number; occupancy: number | null };

export function occupancyFor(period: Period, rules: RuleIn[], timeOff: TimeOffIn[], appointments: AppointmentIn[]): Occupancy {
  const available = availableMinutes(period, rules, timeOff);
  const booked = sumBy(
    appointments.filter((a) => a.status !== "cancelled"),
    minutesOf,
  );
  return { availableMinutes: available, bookedMinutes: booked, occupancy: ratio(booked, available) };
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
export function salesReport(input: { period: Period; charges: ChargeIn[]; payments: PaymentIn[]; names: Names }): ReportResult {
  const { period, charges, payments, names } = input;
  const paid = charges.filter((c) => c.status === "paid");
  const voided = charges.filter((c) => c.status === "voided");
  const paidIds = new Set(paid.map((c) => c.id));

  // Importe por forma de pago, por cobro y en total.
  const byCharge = new Map<string, Record<PaymentMethod, number>>();
  const methods = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, { cents: 0, count: 0 }])) as Record<PaymentMethod, { cents: number; count: number }>;
  for (const p of payments) {
    if (!paidIds.has(p.charge_id)) continue;
    const entry = byCharge.get(p.charge_id) ?? { cash: 0, card: 0, transfer: 0 };
    entry[p.method] += toCents(p.amount);
    byCharge.set(p.charge_id, entry);
    methods[p.method].cents += toCents(p.amount);
    methods[p.method].count += 1;
  }

  const totalCents = sumBy(paid, (c) => toCents(c.total));
  const discountCents = sumBy(paid, (c) => toCents(c.discount));
  const discounted = paid.filter((c) => c.discount > 0).length;

  const t = timeline(period, paid, (c) => localDate(c.created_at, period.timezone));
  const bucketTotals = (list: ChargeIn[]) => {
    const m = { cash: 0, card: 0, transfer: 0 };
    for (const c of list) {
      const e = byCharge.get(c.id);
      if (e) for (const k of PAYMENT_METHODS) m[k] += e[k];
    }
    return {
      cobros: list.length,
      subtotal: money(sumBy(list, (c) => toCents(c.subtotal))),
      descuentos: money(sumBy(list, (c) => toCents(c.discount))),
      total: money(sumBy(list, (c) => toCents(c.total))),
      efectivo: money(m.cash),
      tarjeta: money(m.card),
      transferencia: money(m.transfer),
    };
  };

  const cashiers = groupBy(charges, (c) => c.created_by ?? "");
  const cashierRows: TableRow[] = [...cashiers]
    .map(([id, list]) => {
      const ok = list.filter((c) => c.status === "paid");
      const cents = sumBy(ok, (c) => toCents(c.total));
      return {
        values: {
          cajero: nameOf(names, id || null),
          cobros: ok.length,
          vendido: money(cents),
          ticket: ok.length ? money(Math.round(cents / ok.length)) : null,
          cancelados: list.length - ok.length,
        },
      };
    })
    .sort((a, b) => Number(b.values.vendido) - Number(a.values.vendido));

  return {
    kpis: [
      { label: "Vendido", value: money(totalCents), format: "money", hint: plural(paid.length, "cobro vigente", "cobros vigentes"), strong: true },
      { label: "Ticket promedio", value: paid.length ? money(Math.round(totalCents / paid.length)) : null, format: "money" },
      { label: "Descuentos", value: money(discountCents), format: "money", hint: plural(discounted, "cobro con descuento", "cobros con descuento") },
      {
        label: "Cancelados",
        value: voided.length,
        format: "int",
        hint: voided.length ? `${formatMoney(money(sumBy(voided, (c) => toCents(c.total))))} que no suman` : undefined,
      },
    ],
    charts: [
      {
        id: "vendido",
        kind: "columns",
        title: `Vendido ${GRANULARITY_LABEL[t.granularity].toLowerCase()}`,
        format: "money",
        points: t.buckets.map((b) => {
          const list = t.groups.get(b) ?? [];
          return { label: bucketLabel(b, t.granularity), value: money(sumBy(list, (c) => toCents(c.total))), hint: plural(list.length, "cobro", "cobros") };
        }),
      },
      {
        id: "formas-de-pago",
        kind: "bars",
        title: "Por forma de pago",
        format: "money",
        points: PAYMENT_METHODS.map((m) => ({ label: PAYMENT_LABEL[m], value: money(methods[m].cents), hint: plural(methods[m].count, "pago", "pagos") })),
      },
    ],
    tables: [
      {
        id: "por-periodo",
        title: `Ventas ${GRANULARITY_LABEL[t.granularity].toLowerCase()}`,
        columns: [
          periodColumn(t.granularity),
          { key: "cobros", label: "Cobros", format: "int" },
          { key: "subtotal", label: "Subtotal", format: "money", secondary: true },
          { key: "descuentos", label: "Descuentos", format: "money", secondary: true },
          { key: "total", label: "Vendido", format: "money" },
          { key: "efectivo", label: "Efectivo", format: "money", secondary: true },
          { key: "tarjeta", label: "Tarjeta", format: "money", secondary: true },
          { key: "transferencia", label: "Transferencia", format: "money", secondary: true },
        ],
        rows: t.buckets.filter((b) => t.groups.has(b)).map((b) => ({ values: { periodo: b, ...bucketTotals(t.groups.get(b)!) } })),
        total: { periodo: "Total", ...bucketTotals(paid) },
        empty: "No hay cobros vigentes en el periodo.",
      },
      {
        id: "formas-de-pago",
        title: "Por forma de pago",
        columns: [
          { key: "forma", label: "Forma de pago" },
          { key: "pagos", label: "Pagos", format: "int" },
          { key: "importe", label: "Importe", format: "money" },
          { key: "participacion", label: "Participación", format: "pct" },
        ],
        rows: totalCents
          ? PAYMENT_METHODS.map((m) => ({
              values: { forma: PAYMENT_LABEL[m], pagos: methods[m].count, importe: money(methods[m].cents), participacion: ratio(methods[m].cents, totalCents) },
            }))
          : [],
        total: { forma: "Total", pagos: sumBy(PAYMENT_METHODS, (m) => methods[m].count), importe: money(totalCents), participacion: totalCents ? 1 : null },
        empty: "No hay pagos en el periodo.",
      },
      {
        id: "por-cajero",
        title: "Por cajero",
        description: "Quién registró cada cobro.",
        columns: [
          { key: "cajero", label: "Cajero" },
          { key: "cobros", label: "Cobros", format: "int" },
          { key: "vendido", label: "Vendido", format: "money" },
          { key: "ticket", label: "Ticket promedio", format: "money", secondary: true },
          { key: "cancelados", label: "Cancelados", format: "int" },
        ],
        rows: cashierRows,
        empty: "No hay cobros en el periodo.",
      },
    ],
    notes: [
      "Solo suman los cobros vigentes; los cancelados se cuentan aparte.",
      "Cada cobro cuenta en el día en que se registró, en la zona horaria del espacio.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Ingresos por concepto
// ---------------------------------------------------------------------------
const OTHERS_AFTER = 8;

export function conceptsReport(input: { charges: ChargeIn[]; items: ItemIn[]; serviceNames: Names }): ReportResult {
  const paid = input.charges.filter((c) => c.status === "paid");
  const paidIds = new Set(paid.map((c) => c.id));
  const items = input.items.filter((i) => paidIds.has(i.charge_id));
  const groups = groupBy(items, (i) => (i.service_id ? `s:${i.service_id}` : `l:${i.description.trim().toLocaleLowerCase("es")}`));

  const grossCents = sumBy(items, (i) => toCents(i.amount));
  const rows = [...groups.values()]
    .map((list) => {
      const head = list[0];
      const cents = sumBy(list, (i) => toCents(i.amount));
      const quantity = sumBy(list, (i) => i.quantity);
      return {
        values: {
          concepto: head.service_id ? (input.serviceNames.get(head.service_id) ?? head.description) : head.description.trim(),
          tipo: head.service_id ? "Servicio" : "Concepto libre",
          cantidad: quantity,
          importe: money(cents),
          participacion: ratio(cents, grossCents),
          promedio: quantity ? money(Math.round(cents / quantity)) : null,
          cobros: new Set(list.map((i) => i.charge_id)).size,
        } satisfies Record<string, Cell>,
      };
    })
    .sort((a, b) => b.values.importe - a.values.importe || String(a.values.concepto).localeCompare(String(b.values.concepto), "es"));

  const top: ChartPoint[] = rows.slice(0, OTHERS_AFTER).map((r) => ({ label: String(r.values.concepto), value: r.values.importe, hint: plural(r.values.cantidad, "vendido", "vendidos") }));
  const rest = rows.slice(OTHERS_AFTER);
  if (rest.length) top.push({ label: `Otros (${rest.length})`, value: money(sumBy(rest, (r) => toCents(r.values.importe))) });

  const discountCents = sumBy(paid, (c) => toCents(c.discount));
  return {
    kpis: [
      { label: "Importe bruto", value: money(grossCents), format: "money", hint: "Antes de descuentos" },
      { label: "Descuentos", value: money(discountCents), format: "money" },
      { label: "Neto", value: money(sumBy(paid, (c) => toCents(c.total))), format: "money", strong: true },
      { label: "Conceptos vendidos", value: sumBy(items, (i) => i.quantity), format: "int", hint: plural(rows.length, "concepto distinto", "conceptos distintos") },
    ],
    charts: rows.length ? [{ id: "conceptos", kind: "bars", title: "Conceptos que más ingresan", format: "money", points: top }] : [],
    tables: [
      {
        id: "conceptos",
        title: "Ingresos por concepto",
        columns: [
          { key: "concepto", label: "Concepto" },
          { key: "tipo", label: "Tipo", secondary: true },
          { key: "cantidad", label: "Cantidad", format: "int" },
          { key: "importe", label: "Importe", format: "money" },
          { key: "participacion", label: "Participación", format: "pct" },
          { key: "promedio", label: "Precio promedio", format: "money", secondary: true },
          { key: "cobros", label: "Cobros", format: "int", secondary: true },
        ],
        rows,
        total: { concepto: "Total", cantidad: sumBy(items, (i) => i.quantity), importe: money(grossCents), participacion: grossCents ? 1 : null },
        empty: "No hay conceptos cobrados en el periodo.",
      },
    ],
    notes: [
      "Los importes por concepto son antes de descuentos: el descuento se aplica al cobro completo.",
      "Los servicios del catálogo se agrupan aunque su precio haya cambiado; los conceptos libres, por su descripción.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Cortes de caja
// ---------------------------------------------------------------------------
export function cashClosingsReport(input: {
  period: Period;
  sessions: SessionIn[];
  charges: ChargeIn[];
  payments: PaymentIn[];
  movements: MovementIn[];
  names: Names;
}): ReportResult {
  const { period, names } = input;
  const tz = period.timezone;
  const paidIds = new Set(input.charges.filter((c) => c.status === "paid").map((c) => c.id));
  const paymentsBySession = groupBy(
    input.payments.filter((p) => paidIds.has(p.charge_id)),
    (p) => p.session_id,
  );
  const movementsBySession = groupBy(input.movements, (m) => m.session_id);

  const sessions = [...input.sessions].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  let short = 0;
  let over = 0;
  let withDifference = 0;
  const rows: TableRow[] = sessions.map((s) => {
    const pays = paymentsBySession.get(s.id) ?? [];
    const moves = movementsBySession.get(s.id) ?? [];
    const by = (m: PaymentMethod) => sumBy(pays.filter((p) => p.method === m), (p) => toCents(p.amount));
    const moved = (k: CashMovementKind) => sumBy(moves.filter((m) => m.kind === k), (m) => toCents(m.amount));
    const closed = Boolean(s.closed_at);
    const expected = closed && s.expected_cash !== null ? toCents(s.expected_cash) : toCents(s.opening_amount) + by("cash") + moved("in") - moved("out");
    const diff = closed && s.difference !== null ? toCents(s.difference) : null;
    if (diff !== null && diff < 0) short += -diff;
    if (diff !== null && diff > 0) over += diff;
    if (diff) withDifference += 1;
    return {
      href: closed ? `/ventas/turnos/${s.id}` : "/ventas/caja",
      muted: !closed,
      values: {
        apertura: localStamp(s.opened_at, tz),
        cierre: s.closed_at ? localStamp(s.closed_at, tz) : null,
        estado: closed ? "Cerrado" : "Abierto",
        abrio: nameOf(names, s.opened_by),
        cerro: closed ? nameOf(names, s.closed_by) : null,
        fondo: s.opening_amount,
        efectivo: money(by("cash")),
        tarjeta: money(by("card")),
        transferencia: money(by("transfer")),
        entradas: money(moved("in")),
        salidas: money(moved("out")),
        esperado: money(expected),
        contado: closed ? s.counted_cash : null,
        diferencia: diff === null ? null : money(diff),
      },
    };
  });

  const closedCount = sessions.filter((s) => s.closed_at).length;
  const outCents = sumBy(input.movements.filter((m) => m.kind === "out"), (m) => toCents(m.amount));
  const inCents = sumBy(input.movements.filter((m) => m.kind === "in"), (m) => toCents(m.amount));
  const movements = [...input.movements].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return {
    kpis: [
      { label: "Turnos cerrados", value: closedCount, format: "int", hint: sessions.length > closedCount ? "Más un turno abierto" : undefined },
      { label: "Diferencia neta", value: money(over - short), format: "money", hint: plural(withDifference, "turno con diferencia", "turnos con diferencia"), strong: true },
      { label: "Faltantes", value: money(short), format: "money", hint: "Contado menor al esperado" },
      { label: "Sobrantes", value: money(over), format: "money", hint: "Contado mayor al esperado" },
      { label: "Salidas de efectivo", value: money(outCents), format: "money", hint: inCents ? `Entradas: ${formatMoney(money(inCents))}` : undefined },
    ],
    charts: [],
    tables: [
      {
        id: "turnos",
        title: "Turnos de caja",
        description: "Abre un turno cerrado para ver su corte completo.",
        columns: [
          { key: "apertura", label: "Apertura", format: "datetime" },
          { key: "cierre", label: "Cierre", format: "datetime" },
          { key: "estado", label: "Estado", secondary: true },
          { key: "abrio", label: "Abrió", secondary: true },
          { key: "cerro", label: "Cerró", secondary: true },
          { key: "fondo", label: "Fondo", format: "money", secondary: true },
          { key: "efectivo", label: "Efectivo", format: "money", secondary: true },
          { key: "tarjeta", label: "Tarjeta", format: "money", secondary: true },
          { key: "transferencia", label: "Transferencia", format: "money", secondary: true },
          { key: "entradas", label: "Entradas", format: "money", secondary: true },
          { key: "salidas", label: "Salidas", format: "money", secondary: true },
          { key: "esperado", label: "Esperado", format: "money" },
          { key: "contado", label: "Contado", format: "money" },
          { key: "diferencia", label: "Diferencia", format: "money" },
        ],
        rows,
        empty: "No se abrieron turnos de caja en el periodo.",
      },
      {
        id: "movimientos",
        title: "Entradas y salidas de efectivo",
        columns: [
          { key: "fecha", label: "Fecha", format: "datetime" },
          { key: "tipo", label: "Tipo" },
          { key: "concepto", label: "Concepto" },
          { key: "importe", label: "Importe", format: "money" },
          { key: "registro", label: "Registró", secondary: true },
        ],
        rows: movements.map((m) => ({
          values: {
            fecha: localStamp(m.created_at, tz),
            tipo: m.kind === "in" ? "Entrada" : "Salida",
            concepto: m.concept,
            importe: m.kind === "in" ? m.amount : -m.amount,
            registro: nameOf(names, m.created_by),
          },
        })),
        empty: "No hubo entradas ni salidas de efectivo.",
      },
    ],
    notes: [
      "Incluye los turnos que se abrieron en el periodo. El esperado de un turno cerrado es el que se registró en su corte.",
      "Diferencia = contado − esperado: negativa es faltante y positiva, sobrante. Las salidas aparecen con signo negativo.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Cancelaciones y descuentos (auditoría)
// ---------------------------------------------------------------------------
export function auditReport(input: { period: Period; charges: ChargeIn[]; names: Names; contactNames: Names }): ReportResult {
  const { period, charges, names, contactNames } = input;
  const tz = period.timezone;
  const voided = charges.filter((c) => c.status === "voided").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const discounted = charges.filter((c) => c.status === "paid" && c.discount > 0).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const voidedCents = sumBy(voided, (c) => toCents(c.total));
  const discountCents = sumBy(discounted, (c) => toCents(c.discount));
  const discountBase = sumBy(discounted, (c) => toCents(c.subtotal));
  const patient = (c: ChargeIn) => (c.contact_id ? (contactNames.get(c.contact_id) ?? "Paciente") : "Venta de mostrador");

  const cashiers = [...groupBy(charges, (c) => c.created_by ?? "")]
    .map(([id, list]) => {
      const v = list.filter((c) => c.status === "voided").length;
      const d = list.filter((c) => c.status === "paid" && c.discount > 0);
      return {
        values: {
          cajero: nameOf(names, id || null),
          cobros: list.length,
          cancelados: v,
          tasa: ratio(v, list.length),
          con_descuento: d.length,
          descuentos: money(sumBy(d, (c) => toCents(c.discount))),
        },
      };
    })
    .sort((a, b) => b.values.cancelados - a.values.cancelados || b.values.descuentos - a.values.descuentos);

  return {
    kpis: [
      { label: "Cobros cancelados", value: voided.length, format: "int", hint: `de ${charges.length} registrados` },
      { label: "Importe cancelado", value: money(voidedCents), format: "money", strong: true },
      { label: "Tasa de cancelación", value: ratio(voided.length, charges.length), format: "pct" },
      { label: "Descuentos otorgados", value: money(discountCents), format: "money", hint: plural(discounted.length, "cobro", "cobros") },
      { label: "Descuento promedio", value: ratio(discountCents, discountBase), format: "pct", hint: "Sobre el subtotal de esos cobros" },
    ],
    charts: [],
    tables: [
      {
        id: "cancelados",
        title: "Cobros cancelados",
        columns: [
          { key: "folio", label: "Folio", format: "int" },
          { key: "fecha", label: "Cobrado", format: "datetime" },
          { key: "paciente", label: "Paciente" },
          { key: "total", label: "Total", format: "money" },
          { key: "cobro", label: "Cobró", secondary: true },
          { key: "cancelo", label: "Canceló" },
          { key: "cancelado", label: "Cancelado", format: "datetime", secondary: true },
          { key: "motivo", label: "Motivo" },
        ],
        rows: voided.map((c) => ({
          href: `/ventas/cobros/${c.id}`,
          values: {
            folio: c.folio,
            fecha: localStamp(c.created_at, tz),
            paciente: patient(c),
            total: c.total,
            cobro: nameOf(names, c.created_by),
            cancelo: nameOf(names, c.voided_by),
            cancelado: c.voided_at ? localStamp(c.voided_at, tz) : null,
            motivo: c.void_reason,
          },
        })),
        total: { folio: "Total", total: money(voidedCents) },
        empty: "No se cancelaron cobros en el periodo.",
      },
      {
        id: "descuentos",
        title: "Cobros con descuento",
        columns: [
          { key: "folio", label: "Folio", format: "int" },
          { key: "fecha", label: "Fecha", format: "datetime" },
          { key: "paciente", label: "Paciente" },
          { key: "subtotal", label: "Subtotal", format: "money", secondary: true },
          { key: "descuento", label: "Descuento", format: "money" },
          { key: "porcentaje", label: "%", format: "pct" },
          { key: "total", label: "Total", format: "money" },
          { key: "cobro", label: "Cobró", secondary: true },
        ],
        rows: discounted.map((c) => ({
          href: `/ventas/cobros/${c.id}`,
          values: {
            folio: c.folio,
            fecha: localStamp(c.created_at, tz),
            paciente: patient(c),
            subtotal: c.subtotal,
            descuento: c.discount,
            porcentaje: ratio(toCents(c.discount), toCents(c.subtotal)),
            total: c.total,
            cobro: nameOf(names, c.created_by),
          },
        })),
        total: { folio: "Total", subtotal: money(discountBase), descuento: money(discountCents), porcentaje: ratio(discountCents, discountBase), total: money(discountBase - discountCents) },
        empty: "No se otorgaron descuentos en el periodo.",
      },
      {
        id: "por-cajero",
        title: "Por cajero",
        columns: [
          { key: "cajero", label: "Cajero" },
          { key: "cobros", label: "Cobros", format: "int" },
          { key: "cancelados", label: "Cancelados", format: "int" },
          { key: "tasa", label: "% cancelados", format: "pct" },
          { key: "con_descuento", label: "Con descuento", format: "int", secondary: true },
          { key: "descuentos", label: "Descuentos", format: "money" },
        ],
        rows: cashiers,
        empty: "No hay cobros en el periodo.",
      },
    ],
    notes: ["Cada cobro cuenta en el día en que se registró. «Cobró» es quien lo registró y «Canceló», quien lo anuló (solo Administración)."],
  };
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------
// Orden fijo (validado para daltonismo): ningún par contiguo es verde–rojo.
const STATUS_PARTS: AppointmentStatus[] = ["attended", "confirmed", "pending", "no_show", "cancelled"];

function statusValues(list: AppointmentIn[]) {
  const c = countStatuses(list);
  return { agendadas: scheduled(c), atendidas: c.attended, no_asistio: c.no_show, canceladas: c.cancelled, asistencia: attendance(c) };
}

const STATUS_COLUMNS: Column[] = [
  { key: "agendadas", label: "Agendadas", format: "int" },
  { key: "atendidas", label: "Atendidas", format: "int" },
  { key: "no_asistio", label: "No asistió", format: "int" },
  { key: "canceladas", label: "Canceladas", format: "int" },
  { key: "asistencia", label: "Asistencia", format: "pct" },
];

function appointmentsByPeriod(period: Period, appointments: AppointmentIn[]): { chart: Chart; table: ReportTable } {
  const t = timeline(period, appointments, (a) => localDate(a.starts_at, period.timezone));
  return {
    chart: {
      id: "agendadas",
      kind: "columns",
      title: `Citas agendadas ${GRANULARITY_LABEL[t.granularity].toLowerCase()}`,
      description: "Sin contar canceladas.",
      format: "int",
      points: t.buckets.map((b) => {
        const c = countStatuses(t.groups.get(b) ?? []);
        return { label: bucketLabel(b, t.granularity), value: scheduled(c), hint: `${c.attended} atendidas` };
      }),
    },
    table: {
      id: "por-periodo",
      title: `Citas ${GRANULARITY_LABEL[t.granularity].toLowerCase()}`,
      columns: [periodColumn(t.granularity), ...STATUS_COLUMNS],
      rows: t.buckets.filter((b) => t.groups.has(b)).map((b) => ({ values: { periodo: b, ...statusValues(t.groups.get(b)!) } })),
      total: { periodo: "Total", ...statusValues(appointments) },
      empty: "No hay citas en el periodo.",
    },
  };
}

function appointmentsByService(appointments: AppointmentIn[], serviceNames: Names): ReportTable {
  return {
    id: "por-servicio",
    title: "Por servicio",
    columns: [{ key: "servicio", label: "Servicio" }, ...STATUS_COLUMNS, { key: "horas", label: "Horas", format: "hours", secondary: true }],
    rows: [...groupBy(appointments, (a) => a.service_id)]
      .map(([id, list]) => ({
        values: {
          servicio: nameOf(serviceNames, id, "Servicio"),
          ...statusValues(list),
          horas: hours(sumBy(list.filter((a) => a.status !== "cancelled"), minutesOf)),
        },
      }))
      .sort((a, b) => b.values.agendadas - a.values.agendadas || a.values.servicio.localeCompare(b.values.servicio, "es")),
    empty: "No hay citas en el periodo.",
  };
}

function statusSegments(appointments: AppointmentIn[]): Chart {
  const c = countStatuses(appointments);
  return {
    id: "estados",
    kind: "segments",
    title: "Estado de las citas",
    description: plural(appointments.length, "cita registrada", "citas registradas"),
    parts: STATUS_PARTS.map((s) => ({ key: s, label: STATUS_LABEL[s], value: c[s] })),
  };
}

export function appointmentsReport(input: { period: Period; appointments: AppointmentIn[]; serviceNames: Names; now: Date }): ReportResult {
  const { period, appointments, serviceNames } = input;
  const tz = period.timezone;
  const c = countStatuses(appointments);
  const now = input.now.toISOString();
  const unmarked = appointments.filter((a) => (a.status === "pending" || a.status === "confirmed") && a.starts_at < now).length;
  const active = appointments.filter((a) => a.status !== "cancelled");
  const byPeriod = appointmentsByPeriod(period, appointments);

  // Demanda por día de la semana y hora de inicio.
  const cells = new Map<string, number>();
  let minHour = 24;
  let maxHour = -1;
  let maxWeekday = 6;
  for (const a of active) {
    const p = localParts(a.starts_at, tz);
    const hour = Math.floor(p.minutes / 60);
    const weekday = isoWeekday(p.date);
    cells.set(`${weekday}-${hour}`, (cells.get(`${weekday}-${hour}`) ?? 0) + 1);
    minHour = Math.min(minHour, hour);
    maxHour = Math.max(maxHour, hour);
    maxWeekday = Math.max(maxWeekday, weekday);
  }
  const hoursRange = maxHour >= 0 ? Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i) : [];
  const weekdays = WEEKDAYS.filter((w) => w.iso <= maxWeekday);
  const byWeekday = groupBy(appointments, (a) => String(isoWeekday(localDate(a.starts_at, tz))));

  const charts: Chart[] = [statusSegments(appointments), byPeriod.chart];
  if (hoursRange.length) {
    charts.push({
      id: "demanda",
      kind: "heatmap",
      title: "Horas de mayor demanda",
      description: "Citas agendadas por día de la semana y hora de inicio.",
      rowLabels: weekdays.map((w) => w.short),
      colLabels: hoursRange.map((h) => `${h}:00`),
      values: weekdays.map((w) => hoursRange.map((h) => cells.get(`${w.iso}-${h}`) ?? 0)),
    });
  }

  return {
    kpis: [
      { label: "Agendadas", value: scheduled(c), format: "int", hint: `De ${appointments.length} registradas`, strong: true },
      { label: "Atendidas", value: c.attended, format: "int" },
      { label: "No asistió", value: c.no_show, format: "int" },
      { label: "Canceladas", value: c.cancelled, format: "int", hint: appointments.length ? `${formatCell(ratio(c.cancelled, appointments.length), "pct")} de las registradas` : undefined },
      { label: "Asistencia", value: attendance(c), format: "pct", hint: "Atendidas ÷ (atendidas + no asistió)" },
      { label: "Pasadas sin marcar", value: unmarked, format: "int", hint: "Pendientes o confirmadas que ya ocurrieron" },
    ],
    charts,
    tables: [
      byPeriod.table,
      appointmentsByService(appointments, serviceNames),
      {
        id: "por-dia-de-la-semana",
        title: "Por día de la semana",
        columns: [{ key: "dia", label: "Día" }, ...STATUS_COLUMNS],
        rows: WEEKDAYS.filter((w) => byWeekday.has(String(w.iso))).map((w) => ({ values: { dia: w.label, ...statusValues(byWeekday.get(String(w.iso))!) } })),
        empty: "No hay citas en el periodo.",
      },
    ],
    notes: [
      "Cada cita cuenta en el día de su hora de inicio, en la zona horaria del espacio.",
      "«Agendadas» excluye las canceladas. La asistencia solo considera citas ya resueltas (atendidas o no asistió).",
    ],
  };
}

// ---------------------------------------------------------------------------
// Desempeño por profesional
// ---------------------------------------------------------------------------
export function professionalsReport(input: {
  period: Period;
  professionals: ProfessionalIn[];
  rules: RuleIn[];
  timeOff: TimeOffIn[];
  appointments: AppointmentIn[];
  typeLabels: Names;
  /** Ingresos atribuidos (centavos) por profesional; null si no se muestran. */
  revenue: Map<string, number> | null;
  /** Ventas vigentes sin cita asociada (centavos), para la nota. */
  unattributedCents?: number;
}): ReportResult {
  const { period, revenue } = input;
  const appts = groupBy(input.appointments, (a) => a.professional_id);
  const rules = groupBy(input.rules, (r) => r.professional_id);
  const timeOff = groupBy(input.timeOff, (t) => t.professional_id);
  const professionals = input.professionals
    .filter((p) => p.active || appts.has(p.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "es"));

  let available = 0;
  let booked = 0;
  let revenueTotal = 0;
  const rows: TableRow[] = professionals.map((p) => {
    const list = appts.get(p.id) ?? [];
    const occ = occupancyFor(period, rules.get(p.id) ?? [], timeOff.get(p.id) ?? [], list);
    available += occ.availableMinutes;
    booked += occ.bookedMinutes;
    const cents = revenue?.get(p.id) ?? 0;
    revenueTotal += cents;
    const values: Record<string, Cell> = {
      profesional: p.active ? p.display_name : `${p.display_name} (inactivo)`,
      area: nameOf(input.typeLabels, p.professional_type, p.professional_type),
      disponible: hours(occ.availableMinutes),
      reservado: hours(occ.bookedMinutes),
      ocupacion: occ.occupancy,
      ...statusValues(list),
      pacientes: new Set(list.filter((a) => a.status === "attended").map((a) => a.contact_id)).size,
    };
    if (revenue) values.ingresos = money(cents);
    return { href: `/profesionales/${p.id}`, muted: !p.active, values };
  });

  const all = countStatuses(input.appointments);
  const columns: Column[] = [
    { key: "profesional", label: "Profesional" },
    { key: "area", label: "Área", secondary: true },
    { key: "disponible", label: "Disponible", format: "hours", secondary: true },
    { key: "reservado", label: "Reservado", format: "hours", secondary: true },
    { key: "ocupacion", label: "Ocupación", format: "pct" },
    { key: "agendadas", label: "Agendadas", format: "int" },
    { key: "atendidas", label: "Atendidas", format: "int" },
    { key: "no_asistio", label: "No asistió", format: "int", secondary: true },
    { key: "canceladas", label: "Canceladas", format: "int", secondary: true },
    { key: "asistencia", label: "Asistencia", format: "pct" },
    { key: "pacientes", label: "Pacientes", format: "int", secondary: true },
  ];
  if (revenue) columns.push({ key: "ingresos", label: "Ingresos", format: "money" });

  const total: Record<string, Cell> = {
    profesional: "Total",
    disponible: hours(available),
    reservado: hours(booked),
    ocupacion: ratio(booked, available),
    ...statusValues(input.appointments),
    pacientes: new Set(input.appointments.filter((a) => a.status === "attended").map((a) => a.contact_id)).size,
  };
  if (revenue) total.ingresos = money(revenueTotal);

  const kpis: Kpi[] = [
    { label: "Ocupación", value: ratio(booked, available), format: "pct", hint: "Reservado ÷ disponible", strong: true },
    { label: "Horas disponibles", value: hours(available), format: "hours" },
    { label: "Horas reservadas", value: hours(booked), format: "hours" },
    { label: "Asistencia", value: attendance(all), format: "pct" },
  ];
  if (revenue) kpis.push({ label: "Ingresos atribuidos", value: money(revenueTotal), format: "money", hint: "Cobros ligados a una cita" });

  const notes = [
    "La disponibilidad usa el horario semanal vigente de cada profesional y descuenta sus bloqueos (vacaciones, comida, ausencias).",
    "Lo reservado suma la duración de las citas no canceladas, incluidas las de «No asistió», que también ocuparon el espacio.",
  ];
  if (revenue) {
    notes.push(
      `Los ingresos se atribuyen al profesional de la cita cobrada${
        input.unattributedCents ? `; ${formatMoney(money(input.unattributedCents))} en ventas sin cita no se atribuyen a nadie` : ""
      }.`,
    );
  }

  const occupancyPoints = rows.map((r) => ({
    label: String(r.values.profesional),
    value: Number(r.values.ocupacion ?? 0),
    hint: `${r.values.reservado} de ${r.values.disponible} h`,
  }));
  return {
    kpis,
    charts: rows.length ? [{ id: "ocupacion", kind: "bars", title: "Ocupación por profesional", format: "pct", points: occupancyPoints, max: Math.max(1, ...occupancyPoints.map((p) => p.value)) }] : [],
    tables: [{ id: "profesionales", title: "Profesionales", columns, rows, total, empty: "No hay profesionales en esta selección." }],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------
export function patientsReport(input: {
  period: Period;
  appointments: AppointmentIn[];
  contacts: Map<string, ContactIn>;
  /** Pacientes con al menos una cita atendida antes del periodo. */
  attendedBefore: Set<string>;
  newContacts: NewContactIn[];
  names: Names;
  /** Gasto vigente por paciente en el periodo (centavos); null si no se muestra. */
  spend: Map<string, number> | null;
}): ReportResult {
  const { period, appointments, contacts, attendedBefore, names, spend } = input;
  const tz = period.timezone;
  const byContact = groupBy(appointments, (a) => a.contact_id);
  const attended = new Set(appointments.filter((a) => a.status === "attended").map((a) => a.contact_id));
  const firstTime = [...attended].filter((id) => !attendedBefore.has(id));
  const contactName = (id: string) => contacts.get(id)?.full_name ?? "Paciente";

  const frequentRows: TableRow[] = [...byContact]
    .map(([id, list]) => {
      const c = countStatuses(list);
      const last = list.filter((a) => a.status === "attended").reduce<string | null>((max, a) => (!max || a.starts_at > max ? a.starts_at : max), null);
      const values: Record<string, Cell> = {
        paciente: contactName(id),
        atendidas: c.attended,
        no_asistio: c.no_show,
        canceladas: c.cancelled,
        ultima: last ? localDate(last, tz) : null,
        tipo: c.attended ? (attendedBefore.has(id) ? "Recurrente" : "Primera vez") : "—",
      };
      if (spend) values.gasto = money(spend.get(id) ?? 0);
      return { href: `/pacientes/${id}`, values };
    })
    .filter((r) => Number(r.values.atendidas) > 0)
    .sort((a, b) => Number(b.values.atendidas) - Number(a.values.atendidas) || String(a.values.paciente).localeCompare(String(b.values.paciente), "es"));

  const noShowRows: TableRow[] = [...byContact]
    .map(([id, list]) => {
      const misses = list.filter((a) => a.status === "no_show").sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      const contact = contacts.get(id);
      return {
        href: `/pacientes/${id}`,
        values: {
          paciente: contactName(id),
          telefono: contact?.phone ?? null,
          correo: contact?.email ?? null,
          no_asistio: misses.length,
          ultima: misses[0] ? localStamp(misses[0].starts_at, tz) : null,
        } satisfies Record<string, Cell>,
      };
    })
    .filter((r) => r.values.no_asistio > 0)
    .sort((a, b) => b.values.no_asistio - a.values.no_asistio || a.values.paciente.localeCompare(b.values.paciente, "es"));

  const t = timeline(
    period,
    appointments.filter((a) => a.status === "attended"),
    (a) => localDate(a.starts_at, tz),
  );

  const frequentColumns: Column[] = [
    { key: "paciente", label: "Paciente" },
    { key: "atendidas", label: "Atendidas", format: "int" },
    { key: "no_asistio", label: "No asistió", format: "int", secondary: true },
    { key: "canceladas", label: "Canceladas", format: "int", secondary: true },
    { key: "ultima", label: "Última visita", format: "date" },
    { key: "tipo", label: "Tipo", secondary: true },
  ];
  if (spend) frequentColumns.push({ key: "gasto", label: "Pagado", format: "money" });

  const newCount = new Map<string, number>();
  for (const a of appointments) newCount.set(a.contact_id, (newCount.get(a.contact_id) ?? 0) + 1);

  return {
    kpis: [
      { label: "Pacientes atendidos", value: attended.size, format: "int", hint: "Distintos, con al menos una cita atendida", strong: true },
      { label: "Primera vez", value: firstTime.length, format: "int", hint: "Su primera cita atendida fue en el periodo" },
      { label: "Recurrentes", value: attended.size - firstTime.length, format: "int", hint: "Ya habían sido atendidos antes" },
      { label: "Registros nuevos", value: input.newContacts.length, format: "int", hint: "Pacientes dados de alta en el periodo" },
      { label: "Con inasistencias", value: noShowRows.length, format: "int" },
    ],
    charts: [
      {
        id: "atendidos",
        kind: "columns",
        title: `Pacientes atendidos ${GRANULARITY_LABEL[t.granularity].toLowerCase()}`,
        description: "Pacientes distintos en cada periodo.",
        format: "int",
        points: t.buckets.map((b) => ({ label: bucketLabel(b, t.granularity), value: new Set((t.groups.get(b) ?? []).map((a) => a.contact_id)).size })),
      },
    ],
    tables: [
      { id: "frecuentes", title: "Pacientes atendidos", description: "Ordenados por número de visitas.", columns: frequentColumns, rows: frequentRows, empty: "No hay pacientes atendidos en el periodo.", preview: 25 },
      {
        id: "inasistencias",
        title: "Pacientes con inasistencias",
        description: "Para dar seguimiento o confirmar sus próximas citas.",
        columns: [
          { key: "paciente", label: "Paciente" },
          { key: "telefono", label: "Teléfono" },
          { key: "correo", label: "Correo", secondary: true },
          { key: "no_asistio", label: "No asistió", format: "int" },
          { key: "ultima", label: "Última inasistencia", format: "datetime", secondary: true },
        ],
        rows: noShowRows,
        empty: "Ningún paciente faltó a su cita en el periodo.",
        preview: 25,
      },
      {
        id: "nuevos",
        title: "Pacientes registrados en el periodo",
        columns: [
          { key: "paciente", label: "Paciente" },
          { key: "registrado", label: "Registrado", format: "datetime" },
          { key: "registro", label: "Registró", secondary: true },
          { key: "citas", label: "Citas en el periodo", format: "int" },
        ],
        rows: [...input.newContacts]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((c) => ({
            href: `/pacientes/${c.id}`,
            values: { paciente: c.full_name, registrado: localStamp(c.created_at, tz), registro: nameOf(names, c.created_by), citas: newCount.get(c.id) ?? 0 },
          })),
        empty: "No se registraron pacientes en el periodo.",
        preview: 25,
      },
    ],
    notes: [
      "«Primera vez» y «Recurrentes» se calculan con las citas atendidas de toda la historia del espacio.",
      "Los registros nuevos no dependen del área ni del profesional elegidos.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Citas atendidas sin cobro
// ---------------------------------------------------------------------------
export function receivablesReport(input: {
  period: Period;
  /** Citas atendidas del periodo. */
  appointments: AppointmentIn[];
  /** Citas con un cobro vigente. */
  charged: Set<string>;
  services: Map<string, { name: string; price: number }>;
  professionalNames: Names;
  contactNames: Names;
}): ReportResult {
  const { period, services } = input;
  const attended = input.appointments.filter((a) => a.status === "attended");
  const pending = attended.filter((a) => !input.charged.has(a.id)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const price = (a: AppointmentIn) => toCents(services.get(a.service_id)?.price ?? 0);
  const totalCents = sumBy(pending, price);
  const byProfessional = [...groupBy(pending, (a) => a.professional_id)]
    .map(([id, list]) => ({ label: nameOf(input.professionalNames, id, "Profesional"), value: money(sumBy(list, price)), hint: plural(list.length, "cita", "citas") }))
    .sort((a, b) => b.value - a.value);

  return {
    kpis: [
      { label: "Citas sin cobro", value: pending.length, format: "int", hint: `De ${attended.length} atendidas` },
      { label: "Importe estimado", value: money(totalCents), format: "money", hint: "Al precio de lista", strong: true },
      { label: "Pacientes", value: new Set(pending.map((a) => a.contact_id)).size, format: "int" },
      { label: "Atendidas cobradas", value: ratio(attended.length - pending.length, attended.length), format: "pct" },
    ],
    charts: byProfessional.length > 1 ? [{ id: "por-profesional", kind: "bars", title: "Pendiente por profesional", format: "money", points: byProfessional }] : [],
    tables: [
      {
        id: "citas",
        title: "Citas atendidas sin cobro",
        description: "Abre al paciente para ver su historial de citas.",
        columns: [
          { key: "fecha", label: "Cita", format: "datetime" },
          { key: "paciente", label: "Paciente" },
          { key: "profesional", label: "Profesional", secondary: true },
          { key: "servicio", label: "Servicio" },
          { key: "precio", label: "Precio de lista", format: "money" },
        ],
        rows: pending.map((a) => ({
          href: `/pacientes/${a.contact_id}`,
          values: {
            fecha: localStamp(a.starts_at, period.timezone),
            paciente: nameOf(input.contactNames, a.contact_id, "Paciente"),
            profesional: nameOf(input.professionalNames, a.professional_id, "Profesional"),
            servicio: services.get(a.service_id)?.name ?? "Servicio",
            precio: money(price(a)),
          },
        })),
        total: { fecha: "Total", precio: money(totalCents) },
        empty: "Todas las citas atendidas del periodo tienen su cobro.",
      },
    ],
    notes: [
      "El importe usa el precio de lista vigente de cada servicio; el cobro real puede variar por descuentos o conceptos adicionales.",
      "Una cita cuenta como cobrada cuando tiene un cobro vigente ligado a ella (por ejemplo, desde «Citas de hoy por cobrar» en Caja).",
    ],
  };
}

// ---------------------------------------------------------------------------
// Mi actividad (rol Profesional o quien atiende consultas)
// ---------------------------------------------------------------------------
export function myActivityReport(input: {
  period: Period;
  appointments: AppointmentIn[];
  rules: RuleIn[];
  timeOff: TimeOffIn[];
  serviceNames: Names;
}): ReportResult {
  const { period, appointments } = input;
  const c = countStatuses(appointments);
  const occ = occupancyFor(period, input.rules, input.timeOff, appointments);
  const byPeriod = appointmentsByPeriod(period, appointments);
  return {
    kpis: [
      { label: "Agendadas", value: scheduled(c), format: "int", hint: `De ${appointments.length} registradas`, strong: true },
      { label: "Atendidas", value: c.attended, format: "int" },
      { label: "No asistió", value: c.no_show, format: "int" },
      { label: "Asistencia", value: attendance(c), format: "pct" },
      { label: "Pacientes atendidos", value: new Set(appointments.filter((a) => a.status === "attended").map((a) => a.contact_id)).size, format: "int" },
      { label: "Ocupación", value: occ.occupancy, format: "pct", hint: `${hours(occ.bookedMinutes)} de ${hours(occ.availableMinutes)} h disponibles` },
    ],
    charts: [statusSegments(appointments), byPeriod.chart],
    tables: [byPeriod.table, appointmentsByService(appointments, input.serviceNames)],
    notes: [
      "Solo incluye tus citas. La ocupación usa tu horario semanal vigente y descuenta tus bloqueos.",
      "Los cobros los consulta Administración; este reporte no muestra importes.",
    ],
  };
}
