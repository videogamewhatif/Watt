// Datos FICTICIOS de facturación para la demostración: catálogo inicial, las
// suscripciones de los tres espacios demo y una cartera de clientes ficticios con
// historial (para las métricas del panel de Wattalis). Fechas relativas a hoy.
import { DEFAULT_PLANS, DEFAULT_SETTINGS } from "./catalog";
import { renderEmail, type TemplateKey } from "./notifications";
import { addDaysIso, addInterval, annualFromMonthly, formatCents, INTERVAL_LABEL, taxBreakdown } from "./pricing";
import type { BillingData } from "./repository";
import { findTestCard } from "./test-cards";
import type { BillingInterval, PlanRow, SubscriptionEventRow, SubscriptionRow, SubscriptionStatus } from "./types";

export const DEMO_ORG = {
  clinic: "b0000000-0000-4000-8000-000000000001",
  independent: "b0000000-0000-4000-8000-000000000002",
  nutrition: "b0000000-0000-4000-8000-000000000003",
} as const;

const DEMO_USERS = { laura: "a0000000-0000-4000-8000-000000000001", luis: "a0000000-0000-4000-8000-000000000004", mario: "a0000000-0000-4000-8000-000000000002" };

const planId = (i: number) => `90000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
const idFrom = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Customer = {
  orgId: string;
  name: string;
  kind: "hospital" | "clinic" | "independent";
  contact: string;
  email: string;
  plan: string;
  interval: BillingInterval;
  /**
   * - paid: renovaciones completadas y el periodo actual empezó hace `offsetDays`.
   * - past_due / grace_period / unpaid: la última renovación (hace `offsetDays`) no se cobró.
   * - canceled: terminó hace `offsetDays` tras `periods` renovaciones.
   * - trialing / expired / incomplete: sin cobros (prueba o contratación sin pagar), inició hace `offsetDays`.
   */
  state: "paid" | "past_due" | "grace_period" | "unpaid" | "canceled" | "trialing" | "expired" | "incomplete";
  periods: number;
  offsetDays: number;
  card?: string;
  /** Índices de renovación que fallaron y luego se regularizaron. */
  recovered?: number[];
  cancelAtPeriodEnd?: boolean;
  cancellationReason?: string;
  customPriceCents?: number;
  linkedWorkspaces?: number;
  owner?: string;
};

const CUSTOMERS: Customer[] = [
  { orgId: DEMO_ORG.clinic, name: "Clínica Arboleda (demo)", kind: "clinic", contact: "Laura Gómez", email: "admin@clinica-arboleda.test", plan: "empresarial", interval: "month", state: "paid", periods: 4, offsetDays: 18, card: "visa_4242", owner: DEMO_USERS.laura },
  { orgId: DEMO_ORG.independent, name: "Consultorio Dr. Herrera (demo)", kind: "independent", contact: "Luis Herrera", email: "luis.herrera@consultorio.test", plan: "esencial", interval: "month", state: "paid", periods: 2, offsetDays: 10, card: "mc_4444", owner: DEMO_USERS.luis },
  { orgId: DEMO_ORG.nutrition, name: "Centro de Nutrición Vital (demo)", kind: "clinic", contact: "Mario Pérez", email: "recepcion@clinica-arboleda.test", plan: "profesional", interval: "month", state: "trialing", periods: 0, offsetDays: 5, card: "visa_4242", owner: DEMO_USERS.mario },
  { orgId: idFrom("e1000000", 1), name: "Hospital San Rafael (demo)", kind: "hospital", contact: "Dirección administrativa", email: "facturacion@san-rafael.example", plan: "corporativo", interval: "year", state: "paid", periods: 0, offsetDays: 200, card: "amex_8431", customPriceCents: 18_870_000, linkedWorkspaces: 2 },
  { orgId: idFrom("e1000000", 2), name: "Clínica Dental Sonrisa Plena (demo)", kind: "clinic", contact: "Andrea Lozano", email: "admin@sonrisa-plena.example", plan: "profesional", interval: "year", state: "paid", periods: 0, offsetDays: 250, card: "visa_4242" },
  { orgId: idFrom("e1000000", 3), name: "Consultorio Dra. Patricia Méndez (demo)", kind: "independent", contact: "Patricia Méndez", email: "pmendez@consultorio.example", plan: "esencial", interval: "month", state: "paid", periods: 7, offsetDays: 12, card: "mc_4444", recovered: [3] },
  { orgId: idFrom("e1000000", 4), name: "Centro Médico Aurora (demo)", kind: "clinic", contact: "Roberto Salinas", email: "admin@aurora.example", plan: "empresarial", interval: "month", state: "paid", periods: 6, offsetDays: 5, card: "visa_4242" },
  { orgId: idFrom("e1000000", 5), name: "Psicología Integral Bosque (demo)", kind: "clinic", contact: "Mónica Treviño", email: "admin@psico-bosque.example", plan: "profesional", interval: "month", state: "past_due", periods: 5, offsetDays: 2, card: "visa_0002" },
  { orgId: idFrom("e1000000", 6), name: "Óptica Visión Clara (demo)", kind: "independent", contact: "Javier Ortiz", email: "javier@vision-clara.example", plan: "esencial", interval: "month", state: "grace_period", periods: 4, offsetDays: 5, card: "visa_0002" },
  { orgId: idFrom("e1000000", 7), name: "Consultorio Dr. Iván Robles (demo)", kind: "independent", contact: "Iván Robles", email: "ivan@robles.example", plan: "esencial", interval: "month", state: "unpaid", periods: 3, offsetDays: 16, card: "visa_0002" },
  { orgId: idFrom("e1000000", 8), name: "Nutrición y Bienestar Ceiba (demo)", kind: "independent", contact: "Lucía Campos", email: "lucia@ceiba.example", plan: "esencial", interval: "month", state: "canceled", periods: 5, offsetDays: 95, card: "mc_4444", cancellationReason: "Cerró el consultorio." },
  { orgId: idFrom("e1000000", 9), name: "Clínica Familiar Los Pinos (demo)", kind: "clinic", contact: "Héctor Ramos", email: "admin@lospinos.example", plan: "profesional", interval: "month", state: "canceled", periods: 8, offsetDays: 20, card: "visa_4242", cancellationReason: "Cambio de sistema." },
  { orgId: idFrom("e1000000", 10), name: "Fisioterapia Movimiento (demo)", kind: "clinic", contact: "Sergio Vela", email: "admin@movimiento.example", plan: "profesional", interval: "month", state: "paid", periods: 1, offsetDays: 8, card: "mc_4444", recovered: [1] },
  { orgId: idFrom("e1000000", 11), name: "Dermatología Piel Sana (demo)", kind: "independent", contact: "Elena Villarreal", email: "elena@pielsana.example", plan: "profesional", interval: "month", state: "trialing", periods: 0, offsetDays: 10, card: "visa_4242" },
  { orgId: idFrom("e1000000", 12), name: "Laboratorio Clínico Delta (demo)", kind: "clinic", contact: "Gabriela Núñez", email: "admin@delta.example", plan: "empresarial", interval: "year", state: "paid", periods: 0, offsetDays: 100, card: "amex_8431", cancelAtPeriodEnd: true, cancellationReason: "Integrarán su propio sistema de laboratorio." },
  { orgId: idFrom("e1000000", 13), name: "Consultorio Pediátrico Arcoíris (demo)", kind: "independent", contact: "Diana Flores", email: "diana@arcoiris.example", plan: "esencial", interval: "month", state: "incomplete", periods: 0, offsetDays: 1 },
  { orgId: idFrom("e1000000", 14), name: "Clínica de Especialidades Norte (demo)", kind: "clinic", contact: "Ricardo Ibarra", email: "admin@esp-norte.example", plan: "profesional", interval: "month", state: "expired", periods: 0, offsetDays: 40 },
  { orgId: idFrom("e1000000", 15), name: "Centro Odontológico Riviera (demo)", kind: "clinic", contact: "Paola Rentería", email: "admin@riviera.example", plan: "empresarial", interval: "month", state: "paid", periods: 1, offsetDays: 3, card: "visa_4242" },
  { orgId: idFrom("e1000000", 16), name: "Clínica Integral Valle (demo)", kind: "clinic", contact: "Fernando Aguilar", email: "admin@valle.example", plan: "profesional", interval: "month", state: "paid", periods: 10, offsetDays: 7, card: "mc_4444", recovered: [6] },
];

export function buildBillingSeed(nowDate = new Date(), appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"): BillingData {
  const nowIso = nowDate.toISOString();
  const settings = { ...DEFAULT_SETTINGS, updated_at: nowIso, updated_by: null };
  const plans: PlanRow[] = DEFAULT_PLANS.map((p, i) => ({
    id: planId(i),
    code: p.code,
    name: p.name,
    description: p.description,
    monthly_price_cents: p.monthly_price_cents,
    annual_price_cents: p.monthly_price_cents === null ? null : annualFromMonthly(p.monthly_price_cents, settings.annual_discount_bps),
    currency: "MXN",
    is_active: true,
    is_custom_pricing: p.monthly_price_cents === null,
    badge: p.badge,
    tier: p.tier,
    display_order: (i + 1) * 10,
    created_at: nowIso,
    updated_at: nowIso,
  }));
  const data: BillingData = {
    settings,
    plans,
    plan_entitlements: DEFAULT_PLANS.flatMap((p, i) => [
      ...Object.entries(p.limits).map(([code, limit], j) => ({ id: idFrom("91000000", i * 100 + j + 1), plan_id: planId(i), feature_code: code, enabled: true, usage_limit: limit, created_at: nowIso })),
      ...p.features.map((code, j) => ({ id: idFrom("91000000", i * 100 + 50 + j), plan_id: planId(i), feature_code: code, enabled: true, usage_limit: null, created_at: nowIso })),
    ]),
    billing_accounts: [],
    billing_account_workspaces: [],
    subscriptions: [],
    subscription_events: [],
    billing_invoices: [],
    payment_attempts: [],
    subscription_change_requests: [],
    billing_payment_methods: [],
    billing_notifications: [],
    billing_audit_log: [],
    sales_leads: [],
    checkout_sessions: [],
    invoice_seq: 0,
  };

  let n = 0;
  const uid = (prefix: string) => idFrom(prefix, ++n);
  const days = (d: number) => addDaysIso(nowIso, -d);

  CUSTOMERS.forEach((c, ci) => {
    const plan = plans.find((p) => p.code === c.plan)!;
    const price = c.customPriceCents ?? (c.interval === "month" ? plan.monthly_price_cents! : plan.annual_price_cents!);
    const accountId = idFrom("92000000", ci + 1);
    const subId = idFrom("93000000", ci + 1);
    data.billing_accounts.push({
      id: accountId,
      organization_id: c.orgId,
      legal_name: c.name,
      billing_email: c.email,
      contact_name: c.contact,
      phone: "55 0000 0000",
      country: "MX",
      timezone: "America/Mexico_City",
      establishment_type: c.kind,
      provider: "mock",
      provider_customer_id: `cus_demo_seed${ci + 1}`,
      created_at: days(c.offsetDays + 400),
      updated_at: nowIso,
    });
    for (let w = 0; w < (c.linkedWorkspaces ?? 0); w++) {
      data.billing_account_workspaces.push({ billing_account_id: accountId, workspace_id: idFrom("e2000000", ci * 10 + w + 1), created_at: nowIso });
    }
    const card = c.card ? findTestCard(c.card) : null;
    if (card) {
      data.billing_payment_methods.push({
        id: uid("94000000"),
        billing_account_id: accountId,
        provider_payment_method_id: `pm_demo_${card.key}_${ci}`,
        brand: card.brand,
        last4: card.last4,
        exp_month: card.expMonth,
        exp_year: card.expYear,
        is_default: true,
        demo_behavior: card.behavior,
        created_at: days(c.offsetDays + 30),
      });
    }

    const events: SubscriptionEventRow[] = [];
    const event = (at: string, type: string, from: SubscriptionStatus | null, to: SubscriptionStatus | null, payload: Record<string, unknown> = {}, source: SubscriptionEventRow["source"] = "provider") =>
      events.push({ id: uid("95000000"), subscription_id: subId, event_type: type, source, provider_event_id: source === "provider" ? `evt_demo_seed_${n}` : null, actor_id: null, from_status: from, to_status: to, payload, processed_at: at, created_at: at });
    const invoice = (at: string, start: string, end: string, description: string, paid: boolean | "open") => {
      const tax = taxBreakdown(price, settings);
      const id = uid("96000000");
      data.invoice_seq += 1;
      data.billing_invoices.push({
        id,
        billing_account_id: accountId,
        subscription_id: subId,
        invoice_reference: `DEMO-${at.slice(0, 4)}-${String(data.invoice_seq).padStart(6, "0")}`,
        description,
        subtotal_cents: tax.subtotalCents,
        tax_cents: tax.taxCents,
        amount_cents: tax.totalCents,
        currency: "MXN",
        status: paid === true ? "paid" : "open",
        period_start: start,
        period_end: end,
        issued_at: at,
        paid_at: paid === true ? at : null,
        provider_invoice_id: `in_demo_seed_${n}`,
        is_demo: true,
      });
      return { id, amount: tax.totalCents };
    };
    const attempt = (invoiceId: string, amount: number, at: string, ok: boolean) =>
      data.payment_attempts.push({
        id: uid("97000000"),
        subscription_id: subId,
        invoice_id: invoiceId,
        provider_payment_id: `pi_demo_seed_${n}`,
        amount_cents: amount,
        status: ok ? "succeeded" : "failed",
        failure_reason: ok ? null : "Fondos insuficientes (simulado)",
        attempted_at: at,
      });

    const sub: SubscriptionRow = {
      id: subId,
      billing_account_id: accountId,
      workspace_id: c.orgId,
      plan_id: plan.id,
      provider_subscription_id: `sub_demo_seed${ci + 1}`,
      status: "active",
      billing_interval: c.interval,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: Boolean(c.cancelAtPeriodEnd),
      canceled_at: null,
      cancellation_reason: c.cancellationReason ?? null,
      trial_ends_at: null,
      grace_ends_at: null,
      ended_at: null,
      custom_price_cents: c.customPriceCents ?? null,
      created_at: days(c.offsetDays),
      updated_at: nowIso,
    };
    const label = `Plan ${plan.name} · ${INTERVAL_LABEL[c.interval].toLowerCase()}`;

    if (c.state === "trialing" || c.state === "expired") {
      const start = days(c.offsetDays);
      const trialEnd = addDaysIso(start, settings.trial_days);
      event(start, "trial_started", "incomplete", "trialing", { plan: plan.code }, "system");
      Object.assign(sub, { status: "trialing", current_period_start: start, current_period_end: trialEnd, trial_ends_at: trialEnd, provider_subscription_id: null });
      if (c.state === "expired") {
        event(trialEnd, "trial_expired", "trialing", "expired", {}, "system");
        Object.assign(sub, { status: "expired", ended_at: trialEnd });
      }
    } else if (c.state === "incomplete") {
      const start = days(c.offsetDays);
      event(start, "checkout_started", null, "incomplete", { plan: plan.code, interval: c.interval }, "user");
      const inv = invoice(start, start, addInterval(start, c.interval), `${label} · contratación`, "open");
      attempt(inv.id, inv.amount, start, false);
      event(start, "checkout_failed", "incomplete", "incomplete", { reason: "Tarjeta rechazada (simulado)" });
      Object.assign(sub, { status: "incomplete", provider_subscription_id: null });
    } else {
      // Suscripción pagada: renovaciones en orden.
      const failedLast = c.state === "past_due" || c.state === "grace_period" || c.state === "unpaid";
      const anchor = c.state === "canceled" ? days(c.offsetDays) : days(c.offsetDays);
      const totalPeriods = c.state === "canceled" ? c.periods + 1 : c.periods;
      let start = addInterval(anchor, c.interval, -totalPeriods);
      event(start, "checkout_completed", "incomplete", "active", { plan: plan.code, interval: c.interval });
      let inv = invoice(start, start, addInterval(start, c.interval), `${label} · contratación`, true);
      attempt(inv.id, inv.amount, start, true);
      for (let r = 1; r <= c.periods; r++) {
        start = addInterval(start, c.interval);
        const end = addInterval(start, c.interval);
        const isLast = r === c.periods;
        if (isLast && failedLast) {
          inv = invoice(start, start, end, `${label} · renovación`, "open");
          attempt(inv.id, inv.amount, start, false);
          event(start, "payment_failed", "active", "past_due", { invoice: inv.id, reason: "renewal" });
          sub.status = "past_due";
          if (c.state !== "past_due") {
            const retry = addDaysIso(start, 2);
            attempt(inv.id, inv.amount, retry, false);
            event(retry, "payment_retry_failed", "past_due", "grace_period", { invoice: inv.id });
            sub.status = "grace_period";
            sub.grace_ends_at = addDaysIso(retry, settings.grace_period_days);
            if (c.state === "unpaid") {
              event(sub.grace_ends_at, "grace_period_expired", "grace_period", "unpaid", {}, "system");
              sub.status = "unpaid";
            }
          }
        } else if (c.recovered?.includes(r)) {
          inv = invoice(start, start, end, `${label} · renovación`, true);
          attempt(inv.id, inv.amount, start, false);
          event(start, "payment_failed", "active", "past_due", { invoice: inv.id, reason: "renewal" });
          const fix = addDaysIso(start, 2);
          attempt(inv.id, inv.amount, fix, true);
          data.billing_invoices.find((i) => i.id === inv.id)!.paid_at = fix;
          event(fix, "payment_recovered", "past_due", "active", { invoice: inv.id });
        } else {
          inv = invoice(start, start, end, `${label} · renovación`, true);
          attempt(inv.id, inv.amount, start, true);
          event(start, "renewed", "active", "active", { invoice: inv.id });
        }
      }
      sub.current_period_start = start;
      sub.current_period_end = addInterval(start, c.interval);
      if (c.state === "canceled") {
        const end = sub.current_period_end;
        event(addDaysIso(end, -12), "cancel_scheduled", "active", "active", { reason: c.cancellationReason }, "user");
        event(end, "period_ended_canceled", "active", "canceled");
        Object.assign(sub, { status: "canceled", canceled_at: end, ended_at: end, cancel_at_period_end: true });
      }
      if (c.cancelAtPeriodEnd) event(days(3), "cancel_scheduled", "active", "active", { reason: c.cancellationReason }, "user");
    }
    data.subscriptions.push(sub);
    data.subscription_events.push(...events);
  });

  // Avisos ya generados para los espacios demo (bandeja).
  const notify = (orgId: string, key: TemplateKey, at: string, extra: { amount?: number; date?: string } = {}) => {
    const account = data.billing_accounts.find((a) => a.organization_id === orgId)!;
    const sub = data.subscriptions.find((s) => s.billing_account_id === account.id)!;
    const plan = plans.find((p) => p.id === sub.plan_id)!;
    const email = renderEmail(key, {
      organizationName: account.legal_name,
      contactName: account.contact_name,
      planName: plan.name,
      amount: extra.amount !== undefined ? `${formatCents(extra.amount)} MXN` : undefined,
      date: extra.date,
      intervalLabel: INTERVAL_LABEL[sub.billing_interval],
      appUrl,
    });
    data.billing_notifications.push({
      id: uid("98000000"),
      billing_account_id: account.id,
      organization_id: orgId,
      template: key,
      recipient: account.billing_email,
      ...email,
      status: "demo_not_sent",
      created_at: at,
    });
  };
  const fmt = (iso: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date(iso));
  const arboleda = data.subscriptions.find((s) => s.workspace_id === DEMO_ORG.clinic)!;
  const herrera = data.subscriptions.find((s) => s.workspace_id === DEMO_ORG.independent)!;
  const vital = data.subscriptions.find((s) => s.workspace_id === DEMO_ORG.nutrition)!;
  notify(DEMO_ORG.clinic, "payment_succeeded", arboleda.current_period_start!, { amount: taxBreakdown(plans[2].monthly_price_cents!, settings).totalCents });
  notify(DEMO_ORG.independent, "payment_succeeded", herrera.current_period_start!, { amount: taxBreakdown(plans[0].monthly_price_cents!, settings).totalCents });
  notify(DEMO_ORG.nutrition, "welcome", vital.current_period_start!);
  notify(DEMO_ORG.nutrition, "trial_ending", days(0), { date: fmt(vital.trial_ends_at!) });

  return data;
}
