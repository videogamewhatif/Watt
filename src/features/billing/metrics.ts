// Indicadores del panel de la plataforma. Funciones puras sobre las filas de
// facturación. En la demostración TODOS los ingresos son simulados.
import { monthlyRecurringCents, quote } from "./pricing";
import type { BillingAccountRow, BillingSettingsRow, InvoiceRow, PaymentAttemptRow, PlanRow, SubscriptionEventRow, SubscriptionRow, SubscriptionStatus } from "./types";

/** Estados que cuentan como ingreso recurrente (el cliente sigue con servicio y se le cobra). */
export const REVENUE_STATUSES: SubscriptionStatus[] = ["active", "past_due", "grace_period"];
const PAID_START_EVENTS = new Set(["checkout_completed", "trial_converted", "reactivated"]);
const RENEWAL_OK = new Set(["renewed", "payment_recovered", "trial_converted"]);
const RENEWAL_FAILED = new Set(["payment_failed", "payment_retry_failed", "trial_payment_failed"]);

export type MonthPoint = {
  month: string; // YYYY-MM-01
  active: number;
  mrrCents: number;
  newSubscriptions: number;
  cancellations: number;
  renewalsOk: number;
  renewalsFailed: number;
};

export type Metrics = {
  organizations: number;
  active: number;
  trialing: number;
  overdue: number;
  unpaid: number;
  incomplete: number;
  canceled: number;
  canceledLast30: number;
  scheduledCancellations: number;
  mrrCents: number;
  arrCents: number;
  /** Cancelaciones de los últimos 30 días entre las activas al inicio, en puntos base. */
  churnBps: number;
  pendingPayments: number;
  pendingAmountCents: number;
  byPlan: { code: string; name: string; count: number; mrrCents: number }[];
  byStatus: Record<SubscriptionStatus, number>;
  months: MonthPoint[];
  mrrBySubscription: Record<string, number>;
};

function monthKey(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function endOfMonth(key: string) {
  const d = new Date(`${key}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1).toISOString();
}

export function computeMetrics(input: {
  now: string;
  plans: PlanRow[];
  settings: Pick<BillingSettingsRow, "tax_rate_bps" | "prices_include_tax">;
  accounts: BillingAccountRow[];
  subscriptions: SubscriptionRow[];
  invoices: InvoiceRow[];
  attempts: PaymentAttemptRow[];
  events: SubscriptionEventRow[];
}): Metrics {
  const { now, plans, subscriptions, events } = input;
  const planById = new Map(plans.map((p) => [p.id, p]));

  const mrrOf = (s: SubscriptionRow) => {
    const plan = planById.get(s.plan_id);
    if (!plan) return 0;
    const price = s.custom_price_cents ?? quote(plan, s.billing_interval, input.settings)?.periodPriceCents ?? 0;
    return monthlyRecurringCents(price, s.billing_interval);
  };
  const mrrBySubscription: Record<string, number> = {};
  for (const s of subscriptions) mrrBySubscription[s.id] = REVENUE_STATUSES.includes(s.status) ? mrrOf(s) : 0;

  // Inicio pagado y fin de cada suscripción (para la serie histórica).
  const paidStart = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (PAID_START_EVENTS.has(e.event_type) && !paidStart.has(e.subscription_id)) paidStart.set(e.subscription_id, e.created_at);
  }
  const ended = (s: SubscriptionRow) => (["canceled", "expired"].includes(s.status) ? (s.ended_at ?? s.canceled_at ?? s.updated_at) : null);
  const activeAt = (s: SubscriptionRow, at: string) => {
    const start = paidStart.get(s.id);
    const end = ended(s);
    return Boolean(start && start <= at && (!end || end > at));
  };

  const byStatus = Object.fromEntries((["incomplete", "trialing", "active", "past_due", "grace_period", "unpaid", "canceled", "expired"] as SubscriptionStatus[]).map((st) => [st, 0])) as Record<SubscriptionStatus, number>;
  for (const s of subscriptions) byStatus[s.status]++;

  const thirtyAgo = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString();
  const canceledLast30 = subscriptions.filter((s) => s.status === "canceled" && (ended(s) ?? "") > thirtyAgo).length;
  const activeThen = subscriptions.filter((s) => activeAt(s, thirtyAgo)).length;

  const months: MonthPoint[] = [];
  const nowDate = new Date(now);
  for (let i = 11; i >= 0; i--) {
    const key = monthKey(new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - i, 1)).toISOString());
    const cutoff = i === 0 ? now : endOfMonth(key);
    const inMonth = (iso: string | null | undefined) => Boolean(iso && monthKey(iso) === key);
    const alive = subscriptions.filter((s) => activeAt(s, cutoff));
    months.push({
      month: key,
      active: alive.length,
      mrrCents: alive.reduce((n, s) => n + mrrOf(s), 0),
      newSubscriptions: [...paidStart.entries()].filter(([, at]) => inMonth(at)).length,
      cancellations: subscriptions.filter((s) => s.status === "canceled" && inMonth(ended(s))).length,
      renewalsOk: events.filter((e) => RENEWAL_OK.has(e.event_type) && inMonth(e.created_at)).length,
      renewalsFailed: events.filter((e) => RENEWAL_FAILED.has(e.event_type) && inMonth(e.created_at)).length,
    });
  }

  const revenueSubs = subscriptions.filter((s) => REVENUE_STATUSES.includes(s.status));
  const mrrCents = revenueSubs.reduce((n, s) => n + mrrBySubscription[s.id], 0);
  const open = input.invoices.filter((i) => i.status === "open");
  const pendingAttempts = input.attempts.filter((a) => a.status === "pending").length;

  return {
    organizations: input.accounts.length,
    active: byStatus.active,
    trialing: byStatus.trialing,
    overdue: byStatus.past_due + byStatus.grace_period,
    unpaid: byStatus.unpaid,
    incomplete: byStatus.incomplete,
    canceled: byStatus.canceled,
    canceledLast30,
    scheduledCancellations: subscriptions.filter((s) => s.cancel_at_period_end && !["canceled", "expired"].includes(s.status)).length,
    mrrCents,
    arrCents: mrrCents * 12,
    churnBps: activeThen ? Math.round((canceledLast30 * 10_000) / activeThen) : 0,
    pendingPayments: open.length + pendingAttempts,
    pendingAmountCents: open.reduce((n, i) => n + i.amount_cents, 0),
    byPlan: plans
      .map((p) => {
        const subs = subscriptions.filter((s) => s.plan_id === p.id && !["canceled", "expired", "incomplete"].includes(s.status));
        return { code: p.code, name: p.name, count: subs.length, mrrCents: subs.reduce((n, s) => n + mrrBySubscription[s.id], 0) };
      })
      .filter((p) => p.count > 0 || plans.find((x) => x.code === p.code)?.is_active),
    byStatus,
    months,
    mrrBySubscription,
  };
}
