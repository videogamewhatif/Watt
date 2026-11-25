// Servicio de suscripciones: orquesta repositorio, pasarela y avisos. Toda
// operación recibe al Actor (sesión verificada) y valida permisos y tenant aquí,
// en el servidor; ocultar botones en la interfaz es solo presentación.
//
// Regla central: el estado de pago solo cambia al procesar un evento firmado de
// la pasarela (processWebhook). Ni Administración ni Recepción pueden marcar un
// cobro como pagado.
import {
  assertCanManageBilling,
  assertCanReadStatus,
  assertCanViewBilling,
  assertPlatformAdmin,
  assertPlatformStaff,
  BillingAccessError,
} from "./authz";
import { FEATURE_BY_CODE, type FeatureCode, FEATURES, type LimitCode } from "./catalog";
import { type Entitlements, gainedFeatures, lostFeatures, noSubscription, resolveEntitlements } from "./entitlements";
import { computeMetrics } from "./metrics";
import { type NotificationSender, renderEmail, type TemplateKey } from "./notifications";
import { addDaysIso, addInterval, annualFromMonthly, formatCents, INTERVAL_LABEL, type Proration, prorate, quote, taxBreakdown } from "./pricing";
import { isSimulatable } from "./providers/mock";
import type { BillingProvider, BillingWebhookEvent, ProviderCheckoutOutcome } from "./providers/types";
import type { BillingRepository, CheckoutSessionRecord } from "./repository";
import { STATUS_INFO, type SubscriptionEvent, transition } from "./state-machine";
import { findTestCard } from "./test-cards";
import type {
  Actor,
  BillingAccountRow,
  BillingInterval,
  BillingSettingsRow,
  ChangeRequestRow,
  EventSource,
  InvoiceRow,
  PlanEntitlementRow,
  PlanRow,
  SubscriptionRow,
  SubscriptionStatus,
} from "./types";

export class BillingError extends Error {
  readonly domain = "billing";
  constructor(
    message: string,
    readonly code = "billing_error",
  ) {
    super(message);
  }
}

const TERMINAL: SubscriptionStatus[] = ["canceled", "expired"];
const CHANGEABLE: SubscriptionStatus[] = ["active", "trialing"];
const CANCELABLE: SubscriptionStatus[] = ["active", "trialing", "past_due", "grace_period"];

export type Usage = { professionals: number; users: number };

export type BillingDetails = {
  legalName: string;
  establishmentType: string;
  contactName: string;
  billingEmail: string;
  phone: string;
  country: string;
  timezone: string;
};

export type ChangePreview = {
  kind: "upgrade" | "downgrade" | "none";
  currentPlan: PlanRow;
  targetPlan: PlanRow;
  currentInterval: BillingInterval;
  targetInterval: BillingInterval;
  /** Cuándo entra en vigor. */
  effectiveAt: string;
  immediate: boolean;
  proration: Proration | null;
  gained: FeatureCode[];
  lost: FeatureCode[];
  limitWarnings: { code: LimitCode; usage: number; limit: number }[];
  /** Nuevo precio por periodo. */
  newPeriodPriceCents: number | null;
  blocked: string | null;
};

export type SimulationAction =
  | "renew_approved"
  | "renew_declined"
  | "retry_approved"
  | "retry_declined"
  | "expire_grace"
  | "cancel_now"
  | "notify_renewal"
  | "notify_trial_ending";

export type BillingServiceDeps = {
  repo: BillingRepository;
  provider: BillingProvider;
  sender: NotificationSender;
  appUrl: string;
  now?: () => Date;
};

const dateFmt = (iso: string, tz = "America/Mexico_City") => new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: tz }).format(new Date(iso));

export class BillingService {
  constructor(private readonly deps: BillingServiceDeps) {}

  get provider() {
    return this.deps.provider;
  }
  private get repo() {
    return this.deps.repo;
  }
  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  // ===========================================================================
  // Catálogo (público)
  // ===========================================================================

  async getCatalog({ includeInactive = false }: { includeInactive?: boolean } = {}) {
    const [plans, entitlements, settings] = await Promise.all([this.repo.listPlans(), this.repo.listEntitlements(), this.repo.getSettings()]);
    return { plans: plans.filter((p) => includeInactive || p.is_active), entitlements, settings };
  }

  async getPlanByCode(code: string) {
    return this.repo.getPlanByCode(code);
  }

  // ===========================================================================
  // Consultas por espacio
  // ===========================================================================

  /** Suscripción vigente del espacio (o la central de su cuenta); si no hay, la última terminada. */
  private async currentSubscription(workspaceId: string): Promise<SubscriptionRow | null> {
    const own = await this.repo.listSubscriptions({ workspaceId });
    const current = own.find((s) => !TERMINAL.includes(s.status));
    if (current) return current;
    const account = await this.repo.getAccountForWorkspace(workspaceId);
    if (account && account.organization_id !== workspaceId) {
      const central = (await this.repo.listSubscriptions({ billingAccountId: account.id })).find((s) => s.workspace_id === null && !TERMINAL.includes(s.status));
      if (central) return central;
    }
    return own.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  }

  /** Entitlements del espacio. Sin actor = verificación interna del servidor. */
  async getEntitlements(actor: Actor | null, workspaceId: string): Promise<Entitlements> {
    if (actor) assertCanReadStatus(actor, workspaceId);
    const [sub, settings] = await Promise.all([this.currentSubscription(workspaceId), this.repo.getSettings()]);
    if (!sub) return noSubscription(settings.enforce_limits);
    const [plan, ents] = await Promise.all([this.repo.getPlan(sub.plan_id), this.repo.listEntitlements(sub.plan_id)]);
    return resolveEntitlements({ subscription: sub, plan, planEntitlements: ents, enforced: settings.enforce_limits });
  }

  /** Estado y fechas del plan (sin importes): lo puede leer cualquier miembro, como en la política RLS. */
  async getStatusSnapshot(actor: Actor | null, workspaceId: string) {
    if (actor) assertCanReadStatus(actor, workspaceId);
    const sub = await this.currentSubscription(workspaceId);
    if (!sub) return null;
    // Sin precio pactado, motivo de cancelación ni ids de la pasarela.
    return { ...sub, custom_price_cents: null, cancellation_reason: null, provider_subscription_id: null } satisfies SubscriptionRow;
  }

  private priceFor(sub: Pick<SubscriptionRow, "custom_price_cents" | "billing_interval">, plan: PlanRow, settings: BillingSettingsRow): number {
    if (sub.custom_price_cents !== null) return sub.custom_price_cents;
    const q = quote(plan, sub.billing_interval, settings);
    if (!q) throw new BillingError("El plan tiene precio personalizado y la suscripción no tiene un precio pactado.");
    return q.periodPriceCents;
  }

  /** Todo lo que muestra «Mi plan». Solo Administración del espacio (o la plataforma). */
  async getOverview(actor: Actor, workspaceId: string) {
    assertCanViewBilling(actor, workspaceId);
    const [sub, settings, account] = await Promise.all([this.currentSubscription(workspaceId), this.repo.getSettings(), this.repo.getAccountForWorkspace(workspaceId)]);
    const entitlements = await this.getEntitlements(null, workspaceId);
    if (!sub) return { account, subscription: null, plan: null, planEntitlements: [], entitlements, settings, scheduledChange: null, periodPriceCents: null, paymentMethods: account ? await this.repo.listPaymentMethods(account.id) : [], centrallyBilled: false };
    const [plan, planEntitlements, changes, paymentMethods] = await Promise.all([
      this.repo.getPlan(sub.plan_id),
      this.repo.listEntitlements(sub.plan_id),
      this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" }),
      account ? this.repo.listPaymentMethods(account.id) : Promise.resolve([]),
    ]);
    const change = changes[0] ?? null;
    const scheduledChange = change ? { ...change, toPlan: (await this.repo.getPlan(change.to_plan_id))! } : null;
    return {
      account,
      subscription: sub,
      plan: plan!,
      planEntitlements,
      entitlements,
      settings,
      scheduledChange,
      periodPriceCents: this.priceFor(sub, plan!, settings),
      paymentMethods,
      centrallyBilled: Boolean(account && account.organization_id !== workspaceId),
    };
  }

  private async ownAccount(actor: Actor, workspaceId: string, { manage = false } = {}): Promise<BillingAccountRow | null> {
    if (manage) assertCanManageBilling(actor, workspaceId);
    else assertCanViewBilling(actor, workspaceId);
    return this.repo.getAccountByOrganization(workspaceId);
  }

  async listInvoices(actor: Actor, workspaceId: string) {
    const account = await this.ownAccount(actor, workspaceId);
    if (!account) return [];
    const [invoices, attempts] = await Promise.all([this.repo.listInvoices({ billingAccountId: account.id }), this.repo.listAttempts()]);
    return invoices.map((i) => ({ ...i, attempts: attempts.filter((a) => a.invoice_id === i.id) }));
  }

  /** Comprobante individual: valida que pertenezca a una cuenta del espacio que administra el actor. */
  async getInvoice(actor: Actor, workspaceId: string, invoiceId: string) {
    assertCanViewBilling(actor, workspaceId);
    const invoice = await this.repo.getInvoice(invoiceId);
    if (!invoice) return null;
    const account = await this.repo.getAccount(invoice.billing_account_id);
    // Otro espacio: se responde igual que si no existiera (no se revela su existencia).
    if (!account || account.organization_id !== workspaceId) return null;
    const sub = invoice.subscription_id ? await this.repo.getSubscription(invoice.subscription_id) : null;
    const plan = sub ? await this.repo.getPlan(sub.plan_id) : null;
    return { invoice, account, plan };
  }

  async listHistory(actor: Actor, workspaceId: string) {
    assertCanViewBilling(actor, workspaceId);
    const subs = await this.repo.listSubscriptions({ workspaceId });
    if (!subs.length) return [];
    return this.repo.listEvents({ subscriptionIds: subs.map((s) => s.id), limit: 200 });
  }

  async listNotifications(actor: Actor, workspaceId: string) {
    assertCanViewBilling(actor, workspaceId);
    return this.repo.listNotifications({ organizationId: workspaceId, limit: 100 });
  }

  async listPaymentMethods(actor: Actor, workspaceId: string) {
    const account = await this.ownAccount(actor, workspaceId);
    return account ? this.repo.listPaymentMethods(account.id) : [];
  }

  // ===========================================================================
  // Avisos e historial
  // ===========================================================================

  private async notify(account: BillingAccountRow, template: TemplateKey, data: { planName: string; amountCents?: number; date?: string; intervalLabel?: string; fromPlanName?: string; reference?: string }) {
    const email = renderEmail(template, {
      organizationName: account.legal_name,
      contactName: account.contact_name,
      planName: data.planName,
      amount: data.amountCents !== undefined ? `${formatCents(data.amountCents)} MXN` : undefined,
      date: data.date,
      intervalLabel: data.intervalLabel,
      fromPlanName: data.fromPlanName,
      reference: data.reference,
      appUrl: this.deps.appUrl,
    }, { demo: !this.deps.sender.delivers });
    const result = await this.deps.sender.send({ ...email, to: account.billing_email, template, organizationId: account.organization_id, billingAccountId: account.id });
    await this.repo.insertNotification({
      id: crypto.randomUUID(),
      billing_account_id: account.id,
      organization_id: account.organization_id,
      template,
      recipient: account.billing_email,
      ...email,
      status: result.status,
      created_at: this.now(),
    });
  }

  private async recordEvent(
    sub: SubscriptionRow,
    type: string,
    opts: { source: EventSource; providerEventId?: string | null; actorId?: string | null; payload?: Record<string, unknown>; from?: SubscriptionStatus | null; to?: SubscriptionStatus | null },
  ) {
    const at = this.now();
    await this.repo.insertEvent({
      id: crypto.randomUUID(),
      subscription_id: sub.id,
      event_type: type,
      source: opts.source,
      provider_event_id: opts.providerEventId ?? null,
      actor_id: opts.actorId ?? null,
      from_status: opts.from === undefined ? sub.status : opts.from,
      to_status: opts.to === undefined ? sub.status : opts.to,
      payload: opts.payload ?? {},
      processed_at: at,
      created_at: at,
    });
  }

  /** Aplica una transición de la máquina de estados y la registra en el historial. */
  private async applyTransition(
    sub: SubscriptionRow,
    event: SubscriptionEvent,
    patch: Partial<SubscriptionRow>,
    opts: { source: EventSource; providerEventId?: string | null; actorId?: string | null; payload?: Record<string, unknown> },
  ): Promise<SubscriptionRow> {
    const next = transition(sub.status, event);
    const updated = await this.repo.updateSubscription(sub.id, { ...patch, status: next });
    await this.recordEvent(sub, event, { ...opts, from: sub.status, to: next });
    return updated;
  }

  private async context(sub: SubscriptionRow) {
    const [account, plan, settings] = await Promise.all([this.repo.getAccount(sub.billing_account_id), this.repo.getPlan(sub.plan_id), this.repo.getSettings()]);
    if (!account || !plan) throw new BillingError("La suscripción no tiene cuenta o plan.");
    return { account, plan, settings };
  }

  private async createInvoice(input: { account: BillingAccountRow; sub: SubscriptionRow; priceCents: number; description: string; periodStart: string | null; periodEnd: string | null; settings: BillingSettingsRow }): Promise<InvoiceRow> {
    const at = this.now();
    const tax = taxBreakdown(input.priceCents, input.settings);
    return this.repo.insertInvoice({
      id: crypto.randomUUID(),
      billing_account_id: input.account.id,
      subscription_id: input.sub.id,
      invoice_reference: await this.repo.nextInvoiceReference(at),
      description: input.description,
      subtotal_cents: tax.subtotalCents,
      tax_cents: tax.taxCents,
      amount_cents: tax.totalCents,
      currency: "MXN",
      status: "open",
      period_start: input.periodStart,
      period_end: input.periodEnd,
      issued_at: at,
      paid_at: null,
      provider_invoice_id: null,
      is_demo: !this.provider.live,
    });
  }

  // ===========================================================================
  // Eventos de la pasarela (webhooks): verificación, idempotencia y estado
  // ===========================================================================

  /**
   * Procesa un evento de la pasarela. Verifica la firma, descarta duplicados por
   * su identificador y aplica el cambio dentro de una transacción.
   */
  async processWebhook(rawBody: string, signature: string | null): Promise<{ duplicate: boolean; eventId: string }> {
    const event = await this.provider.handleWebhook(rawBody, signature);
    return this.repo.transaction(async () => {
      if (await this.repo.hasProviderEvent(event.id)) return { duplicate: true, eventId: event.id };
      await this.applyProviderEvent(event);
      return { duplicate: false, eventId: event.id };
    });
  }

  private async applyProviderEvent(e: BillingWebhookEvent) {
    const meta = { source: "provider" as const, providerEventId: e.id };
    if (e.type.startsWith("checkout.")) {
      const session = e.data.checkoutSessionId ? await this.repo.getCheckout(e.data.checkoutSessionId) : null;
      if (!session) throw new BillingError("Sesión de pago desconocida.", "not_found");
      const sub = (await this.repo.getSubscription(session.subscription_id))!;
      const { account } = await this.context(sub);
      const plan = (await this.repo.getPlan(session.plan_id))!;
      const at = this.now();
      if (session.status === "completed") {
        await this.recordEvent(sub, "checkout_ignored", { ...meta, payload: { reason: "La sesión ya estaba completada.", type: e.type } });
        return;
      }
      switch (e.type) {
        case "checkout.completed": {
          const event: SubscriptionEvent | null =
            sub.status === "incomplete" ? "checkout_completed" : sub.status === "trialing" ? "trial_converted" : TERMINAL.includes(sub.status) ? "reactivated" : null;
          if (!event) {
            await this.recordEvent(sub, "checkout_ignored", { ...meta, payload: { reason: `Estado ${sub.status}` } });
            return;
          }
          const start = at;
          const end = addInterval(start, session.billing_interval);
          await this.repo.updateInvoice(session.invoice_id, { status: "paid", paid_at: at, period_start: start, period_end: end, provider_invoice_id: `in_${e.id}` });
          await this.repo.insertAttempt({ id: crypto.randomUUID(), subscription_id: sub.id, invoice_id: session.invoice_id, provider_payment_id: e.data.paymentId ?? null, amount_cents: session.amount_cents, status: "succeeded", failure_reason: null, attempted_at: at });
          const providerSub = sub.provider_subscription_id ?? (await this.provider.createSubscription({ customerId: account.provider_customer_id ?? "", planCode: plan.code, interval: session.billing_interval })).providerSubscriptionId;
          const updated = await this.applyTransition(
            sub,
            event,
            { plan_id: plan.id, billing_interval: session.billing_interval, current_period_start: start, current_period_end: end, cancel_at_period_end: false, canceled_at: null, ended_at: null, grace_ends_at: null, cancellation_reason: null, provider_subscription_id: providerSub },
            { ...meta, payload: { checkout: session.id, plan: plan.code, interval: session.billing_interval, amount_cents: session.amount_cents } },
          );
          await this.repo.updateCheckout(session.id, { status: "completed", failure_reason: null });
          // Como en Stripe Checkout, la tarjeta usada queda como predeterminada si no hay otra.
          const pm = e.data.paymentMethod;
          if (pm && !(await this.repo.listPaymentMethods(account.id)).length) {
            await this.repo.insertPaymentMethod({
              id: crypto.randomUUID(),
              billing_account_id: account.id,
              provider_payment_method_id: pm.id,
              brand: pm.brand,
              last4: pm.last4,
              exp_month: pm.expMonth,
              exp_year: pm.expYear,
              is_default: true,
              demo_behavior: "approve",
              created_at: at,
            });
          }
          // Un cambio programado anterior ya no aplica a la nueva contratación.
          for (const c of await this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" })) await this.repo.updateChange(c.id, { status: "canceled" });
          const invoice = (await this.repo.getInvoice(session.invoice_id))!;
          const common = { planName: plan.name, intervalLabel: INTERVAL_LABEL[session.billing_interval], date: dateFmt(updated.current_period_end!, account.timezone) };
          if (event === "checkout_completed") await this.notify(account, "welcome", common);
          await this.notify(account, event === "reactivated" ? "subscription_reactivated" : "subscription_activated", common);
          await this.notify(account, "payment_succeeded", { ...common, amountCents: invoice.amount_cents, reference: invoice.invoice_reference });
          return;
        }
        case "checkout.failed":
          await this.repo.insertAttempt({ id: crypto.randomUUID(), subscription_id: sub.id, invoice_id: session.invoice_id, provider_payment_id: e.data.paymentId ?? null, amount_cents: session.amount_cents, status: "failed", failure_reason: e.data.failureReason ?? "Pago rechazado", attempted_at: at });
          await this.repo.updateCheckout(session.id, { status: "failed", failure_reason: e.data.failureReason ?? "Pago rechazado" });
          await this.recordEvent(sub, "checkout_failed", { ...meta, payload: { checkout: session.id, reason: e.data.failureReason } });
          await this.notify(account, "payment_failed", { planName: plan.name, amountCents: session.amount_cents });
          return;
        case "checkout.pending":
          await this.repo.insertAttempt({ id: crypto.randomUUID(), subscription_id: sub.id, invoice_id: session.invoice_id, provider_payment_id: e.data.paymentId ?? null, amount_cents: session.amount_cents, status: "pending", failure_reason: null, attempted_at: at });
          await this.repo.updateCheckout(session.id, { status: "pending", failure_reason: null });
          await this.recordEvent(sub, "checkout_pending", { ...meta, payload: { checkout: session.id } });
          return;
        case "checkout.canceled":
        case "checkout.expired":
          await this.repo.updateCheckout(session.id, { status: e.type === "checkout.canceled" ? "canceled" : "expired" });
          await this.repo.updateInvoice(session.invoice_id, { status: "void" });
          if (e.type === "checkout.expired" && sub.status === "incomplete") {
            await this.applyTransition(sub, "checkout_expired", { ended_at: at }, { ...meta, payload: { checkout: session.id } });
          } else {
            await this.recordEvent(sub, e.type === "checkout.canceled" ? "checkout_canceled" : "checkout_expired", { ...meta, payload: { checkout: session.id } });
          }
          return;
      }
      return;
    }

    const sub = e.data.subscriptionId ? await this.repo.getSubscription(e.data.subscriptionId) : null;
    if (!sub) throw new BillingError("Suscripción desconocida.", "not_found");
    const { account, plan, settings } = await this.context(sub);
    const at = this.now();
    const invoice = e.data.invoiceId ? await this.repo.getInvoice(e.data.invoiceId) : null;
    const common = { planName: plan.name, intervalLabel: INTERVAL_LABEL[sub.billing_interval] };

    switch (e.type) {
      case "invoice.paid": {
        if (!invoice) throw new BillingError("Comprobante desconocido.", "not_found");
        await this.repo.updateInvoice(invoice.id, { status: "paid", paid_at: at, provider_invoice_id: invoice.provider_invoice_id ?? `in_${e.id}` });
        await this.repo.insertAttempt({ id: crypto.randomUUID(), subscription_id: sub.id, invoice_id: invoice.id, provider_payment_id: e.data.paymentId ?? null, amount_cents: invoice.amount_cents, status: "succeeded", failure_reason: null, attempted_at: at });
        const payload = { invoice: invoice.id, reason: e.data.reason, amount_cents: invoice.amount_cents };
        if (e.data.reason === "renewal") await this.applyTransition(sub, "renewed", {}, { ...meta, payload });
        else if (e.data.reason === "trial_conversion") await this.applyTransition(sub, "trial_converted", { trial_ends_at: sub.trial_ends_at }, { ...meta, payload });
        else if (e.data.reason === "retry") await this.applyTransition(sub, "payment_recovered", { grace_ends_at: null }, { ...meta, payload });
        else await this.recordEvent(sub, "payment_succeeded", { ...meta, payload });
        await this.notify(account, "payment_succeeded", { ...common, amountCents: invoice.amount_cents, reference: invoice.invoice_reference });
        return;
      }
      case "invoice.payment_failed": {
        if (!invoice) throw new BillingError("Comprobante desconocido.", "not_found");
        await this.repo.insertAttempt({ id: crypto.randomUUID(), subscription_id: sub.id, invoice_id: invoice.id, provider_payment_id: e.data.paymentId ?? null, amount_cents: invoice.amount_cents, status: "failed", failure_reason: e.data.failureReason ?? "Pago rechazado", attempted_at: at });
        const payload = { invoice: invoice.id, reason: e.data.reason, failure: e.data.failureReason };
        if (e.data.reason === "upgrade") {
          await this.repo.updateInvoice(invoice.id, { status: "void" });
          await this.recordEvent(sub, "payment_failed", { ...meta, payload });
          return;
        }
        if (e.data.reason === "renewal" && sub.status === "active") await this.applyTransition(sub, "payment_failed", {}, { ...meta, payload });
        else if (e.data.reason === "trial_conversion" && sub.status === "trialing") await this.applyTransition(sub, "trial_payment_failed", {}, { ...meta, payload });
        else if (e.data.reason === "retry" && sub.status === "past_due") {
          const graceEnds = addDaysIso(at, settings.grace_period_days);
          await this.applyTransition(sub, "payment_retry_failed", { grace_ends_at: graceEnds }, { ...meta, payload });
          await this.notify(account, "payment_reminder", { ...common, amountCents: invoice.amount_cents, date: dateFmt(graceEnds, account.timezone) });
          return;
        } else await this.recordEvent(sub, "payment_failed", { ...meta, payload });
        await this.notify(account, "payment_failed", { ...common, amountCents: invoice.amount_cents });
        return;
      }
      case "subscription.trial_ending":
        await this.recordEvent(sub, "trial_ending_notice", meta);
        await this.notify(account, "trial_ending", { ...common, date: sub.trial_ends_at ? dateFmt(sub.trial_ends_at, account.timezone) : undefined });
        return;
      case "subscription.period_ended":
        await this.applyTransition(sub, "period_ended_canceled", { canceled_at: at, ended_at: sub.current_period_end ?? at }, meta);
        await this.notify(account, "subscription_canceled", common);
        return;
      case "subscription.canceled":
        await this.applyTransition(sub, "canceled_immediately", { canceled_at: at, ended_at: at, cancel_at_period_end: false }, meta);
        for (const inv of await this.repo.listInvoices({ subscriptionId: sub.id })) if (inv.status === "open") await this.repo.updateInvoice(inv.id, { status: "uncollectible" });
        await this.notify(account, "subscription_canceled", common);
        return;
    }
  }

  private simulator() {
    const provider = this.provider;
    if (!isSimulatable(provider)) throw new BillingError("Las simulaciones solo están disponibles con la pasarela de demostración.", "not_demo");
    return provider;
  }

  /** La pasarela simulada decide con la tarjeta predeterminada (o el resultado forzado por la plataforma). */
  private async charge(sub: SubscriptionRow, invoice: InvoiceRow, reason: NonNullable<BillingWebhookEvent["data"]["reason"]>, forced?: "approved" | "declined") {
    const provider = this.simulator();
    const methods = await this.repo.listPaymentMethods(sub.billing_account_id);
    const card = methods.find((m) => m.is_default) ?? methods[0];
    const outcome = forced ?? (card ? (card.demo_behavior === "approve" ? "approved" : "declined") : "declined");
    const failureReason = outcome === "declined" ? (card ? "Fondos insuficientes (simulado)" : "No hay un método de pago registrado") : undefined;
    const { rawBody, signature } = provider.signEvent({
      type: outcome === "approved" ? "invoice.paid" : "invoice.payment_failed",
      data: { subscriptionId: sub.id, invoiceId: invoice.id, amountCents: invoice.amount_cents, paymentId: `pi_demo_${crypto.randomUUID().slice(0, 8)}`, reason, failureReason },
    });
    await this.processWebhook(rawBody, signature);
    return outcome;
  }

  // ===========================================================================
  // Contratación
  // ===========================================================================

  /** Crea (o actualiza) la cuenta de facturación del espacio. */
  async ensureAccount(actor: Actor, workspaceId: string, details?: BillingDetails): Promise<BillingAccountRow> {
    assertCanManageBilling(actor, workspaceId);
    return this.repo.transaction(async () => {
      const existing = await this.repo.getAccountByOrganization(workspaceId);
      const at = this.now();
      if (existing) {
        if (!details) return existing;
        return this.repo.updateAccount(existing.id, {
          legal_name: details.legalName,
          billing_email: details.billingEmail,
          contact_name: details.contactName,
          phone: details.phone || null,
          country: details.country,
          timezone: details.timezone,
          establishment_type: details.establishmentType,
        });
      }
      if (!details) throw new BillingError("Faltan los datos de facturación.", "missing_details");
      const id = crypto.randomUUID();
      const { customerId } = await this.provider.createCustomer({ billingAccountId: id, email: details.billingEmail, name: details.legalName });
      return this.repo.insertAccount({
        id,
        organization_id: workspaceId,
        legal_name: details.legalName,
        billing_email: details.billingEmail,
        contact_name: details.contactName,
        phone: details.phone || null,
        country: details.country,
        timezone: details.timezone,
        establishment_type: details.establishmentType,
        provider: this.provider.name,
        provider_customer_id: customerId,
        created_at: at,
        updated_at: at,
      });
    });
  }

  /** ¿Se puede iniciar una contratación en este espacio? Devuelve el motivo si no. */
  async checkoutEligibility(actor: Actor, workspaceId: string): Promise<{ ok: true; mode: "new" | "trial" | "reactivate" | "retry" } | { ok: false; reason: string; status: SubscriptionStatus }> {
    assertCanManageBilling(actor, workspaceId);
    const sub = await this.currentSubscription(workspaceId);
    if (!sub) return { ok: true, mode: "new" };
    if (sub.status === "incomplete") return { ok: true, mode: "retry" };
    if (sub.status === "trialing") return { ok: true, mode: "trial" };
    if (TERMINAL.includes(sub.status)) return { ok: true, mode: "reactivate" };
    return { ok: false, status: sub.status, reason: "Este espacio ya tiene una suscripción. Para cambiar de plan usa Configuración → Suscripción y facturación." };
  }

  async startCheckout(
    actor: Actor,
    input: { workspaceId: string; planCode: string; interval: BillingInterval; acceptedTerms: boolean; idempotencyKey: string },
  ): Promise<{ sessionId: string; url: string }> {
    assertCanManageBilling(actor, input.workspaceId);
    if (!input.acceptedTerms) throw new BillingError("Debes aceptar los términos y condiciones para continuar.", "terms_required");
    return this.repo.transaction(async () => {
      const previous = await this.repo.findCheckoutByKey(input.idempotencyKey);
      if (previous) {
        if (previous.created_by !== actor.userId) throw new BillingAccessError();
        return { sessionId: previous.id, url: `/suscripcion/pago?sesion=${previous.id}` };
      }
      const [plan, settings, account] = await Promise.all([this.repo.getPlanByCode(input.planCode), this.repo.getSettings(), this.repo.getAccountByOrganization(input.workspaceId)]);
      if (!plan || !plan.is_active) throw new BillingError("El plan elegido no está disponible.", "plan_unavailable");
      if (plan.is_custom_pricing) throw new BillingError("El plan Corporativo se contrata con el equipo comercial.", "custom_plan");
      if (!account) throw new BillingError("Completa los datos de la organización antes de continuar.", "missing_details");
      const eligibility = await this.checkoutEligibility(actor, input.workspaceId);
      if (!eligibility.ok) throw new BillingError(eligibility.reason, "already_subscribed");

      const q = quote(plan, input.interval, settings)!;
      const at = this.now();
      let sub = await this.currentSubscription(input.workspaceId);
      if (!sub || (TERMINAL.includes(sub.status) && sub.workspace_id === null)) {
        sub = await this.repo.insertSubscription({
          id: crypto.randomUUID(),
          billing_account_id: account.id,
          workspace_id: input.workspaceId,
          plan_id: plan.id,
          provider_subscription_id: null,
          status: "incomplete",
          billing_interval: input.interval,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false,
          canceled_at: null,
          cancellation_reason: null,
          trial_ends_at: null,
          grace_ends_at: null,
          ended_at: null,
          custom_price_cents: null,
          created_at: at,
          updated_at: at,
        });
      } else if (sub.status === "incomplete") {
        sub = await this.repo.updateSubscription(sub.id, { plan_id: plan.id, billing_interval: input.interval });
      }
      // Sesiones abiertas anteriores quedan sin efecto: solo una contratación en curso.
      for (const s of (await this.repo.listInvoices({ subscriptionId: sub.id })).filter((i) => i.status === "open")) await this.repo.updateInvoice(s.id, { status: "void" });
      const invoice = await this.createInvoice({
        account,
        sub,
        priceCents: q.periodPriceCents,
        description: `Plan ${plan.name} · ${INTERVAL_LABEL[input.interval].toLowerCase()} · ${eligibility.mode === "reactivate" ? "reactivación" : "contratación"}`,
        periodStart: null,
        periodEnd: null,
        settings,
      });
      const created = await this.provider.createCheckoutSession({
        customerId: account.provider_customer_id ?? "",
        billingAccountId: account.id,
        subscriptionId: sub.id,
        planCode: plan.code,
        interval: input.interval,
        amountCents: invoice.amount_cents,
        successUrl: "/suscripcion/confirmacion",
        cancelUrl: "/suscripcion/resumen",
        idempotencyKey: input.idempotencyKey,
      });
      const session: CheckoutSessionRecord = {
        id: created.sessionId,
        provider_session_id: created.sessionId,
        billing_account_id: account.id,
        subscription_id: sub.id,
        plan_id: plan.id,
        billing_interval: input.interval,
        amount_cents: invoice.amount_cents,
        invoice_id: invoice.id,
        status: "open",
        failure_reason: null,
        created_by: actor.userId,
        created_at: at,
        expires_at: created.expiresAt,
        idempotency_key: input.idempotencyKey,
      };
      await this.repo.insertCheckout(session);
      await this.recordEvent(sub, "checkout_started", { source: "user", actorId: actor.userId, payload: { checkout: session.id, plan: plan.code, interval: input.interval, mode: eligibility.mode } });
      return { sessionId: session.id, url: created.url };
    });
  }

  async getCheckout(actor: Actor, sessionId: string) {
    const session = await this.repo.getCheckout(sessionId);
    if (!session) return null;
    const account = await this.repo.getAccount(session.billing_account_id);
    if (!account) return null;
    try {
      assertCanManageBilling(actor, account.organization_id);
    } catch {
      return null; // Sesión de otro espacio: igual que inexistente.
    }
    const [plan, sub, invoice, settings] = await Promise.all([this.repo.getPlan(session.plan_id), this.repo.getSubscription(session.subscription_id), this.repo.getInvoice(session.invoice_id), this.repo.getSettings()]);
    return { session, account, plan: plan!, subscription: sub!, invoice: invoice!, settings };
  }

  /** Paso 5 de la demostración: la persona elige el resultado que devolverá la pasarela simulada. */
  async simulateCheckout(actor: Actor, sessionId: string, outcome: ProviderCheckoutOutcome) {
    const provider = this.simulator();
    const found = await this.getCheckout(actor, sessionId);
    if (!found) throw new BillingAccessError();
    const { session } = found;
    if (!["open", "failed", "pending"].includes(session.status)) throw new BillingError("Esta sesión de pago ya no admite cambios.", "checkout_closed");
    if (outcome === "canceled" && session.status === "pending") throw new BillingError("El pago está pendiente de confirmación; no se puede cancelar desde aquí.", "checkout_pending");
    const type = ({ approved: "checkout.completed", declined: "checkout.failed", pending: "checkout.pending", canceled: "checkout.canceled" } as const)[outcome];
    const { rawBody, signature } = provider.signEvent({
      type,
      data: {
        checkoutSessionId: session.id,
        subscriptionId: session.subscription_id,
        amountCents: session.amount_cents,
        paymentId: `pi_demo_${crypto.randomUUID().slice(0, 8)}`,
        reason: "checkout",
        failureReason: outcome === "declined" ? "Tarjeta rechazada por el banco emisor (simulado)" : undefined,
        paymentMethod: outcome === "approved" ? { id: `pm_demo_${crypto.randomUUID().slice(0, 12)}`, brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 } : undefined,
      },
    });
    return this.processWebhook(rawBody, signature);
  }

  /** Espacio nuevo creado desde /bienvenida: periodo de prueba sin cobro. */
  async startTrial(actor: Actor, workspaceId: string, details: { name: string; email: string; contactName: string; kind: string; timezone: string }) {
    assertCanManageBilling(actor, workspaceId);
    return this.repo.transaction(async () => {
      if (await this.currentSubscription(workspaceId)) return null;
      const settings = await this.repo.getSettings();
      const plan = (await this.repo.getPlanByCode("profesional")) ?? (await this.repo.listPlans()).find((p) => p.is_active && !p.is_custom_pricing);
      if (!plan) return null;
      const account = await this.ensureAccount(actor, workspaceId, {
        legalName: details.name,
        billingEmail: details.email,
        contactName: details.contactName,
        phone: "",
        country: "MX",
        timezone: details.timezone,
        establishmentType: details.kind,
      });
      const at = this.now();
      const ends = addDaysIso(at, settings.trial_days);
      const sub = await this.repo.insertSubscription({
        id: crypto.randomUUID(),
        billing_account_id: account.id,
        workspace_id: workspaceId,
        plan_id: plan.id,
        provider_subscription_id: null,
        status: "incomplete",
        billing_interval: "month",
        current_period_start: at,
        current_period_end: ends,
        cancel_at_period_end: false,
        canceled_at: null,
        cancellation_reason: null,
        trial_ends_at: ends,
        grace_ends_at: null,
        ended_at: null,
        custom_price_cents: null,
        created_at: at,
        updated_at: at,
      });
      await this.applyTransition(sub, "trial_started", {}, { source: "system", actorId: actor.userId, payload: { plan: plan.code, days: settings.trial_days } });
      await this.notify(account, "welcome", { planName: plan.name });
      return sub;
    });
  }

  // ===========================================================================
  // Ciclo de vida (sistema / pasarela)
  // ===========================================================================

  /** Fin del periodo: aplica cancelación o cambio programado y cobra el siguiente periodo. */
  async runRenewal(subscriptionId: string, { outcome, actorId = null }: { outcome?: "approved" | "declined"; actorId?: string | null } = {}) {
    return this.repo.transaction(async () => {
      let sub = await this.repo.getSubscription(subscriptionId);
      if (!sub) throw new BillingError("Suscripción no encontrada.", "not_found");
      if (!["active", "trialing"].includes(sub.status)) throw new BillingError(`Una suscripción en estado «${STATUS_INFO[sub.status].label}» no se renueva.`, "not_renewable");
      if (sub.cancel_at_period_end) {
        const provider = this.simulator();
        const { rawBody, signature } = provider.signEvent({ type: "subscription.period_ended", data: { subscriptionId: sub.id } });
        await this.processWebhook(rawBody, signature);
        return { result: "canceled" as const };
      }
      const [change] = await this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" });
      if (change) {
        const [fromPlan, toPlan] = await Promise.all([this.repo.getPlan(change.from_plan_id), this.repo.getPlan(change.to_plan_id)]);
        sub = await this.repo.updateSubscription(sub.id, { plan_id: change.to_plan_id, billing_interval: change.to_interval });
        await this.repo.updateChange(change.id, { status: "applied", applied_at: this.now() });
        await this.recordEvent(sub, "plan_changed", { source: "system", actorId, payload: { from: fromPlan?.code, to: toPlan?.code, interval: change.to_interval, scheduled: true } });
        const account = (await this.repo.getAccount(sub.billing_account_id))!;
        await this.notify(account, "plan_changed", { planName: toPlan!.name, fromPlanName: fromPlan?.name, date: dateFmt(this.now(), account.timezone) });
      }
      const { account, plan, settings } = await this.context(sub);
      const start = sub.current_period_end ?? this.now();
      const end = addInterval(start, sub.billing_interval);
      const reason = sub.status === "trialing" ? "trial_conversion" : "renewal";
      const invoice = await this.createInvoice({
        account,
        sub,
        priceCents: this.priceFor(sub, plan, settings),
        description: `Plan ${plan.name} · ${INTERVAL_LABEL[sub.billing_interval].toLowerCase()} · ${reason === "renewal" ? "renovación" : "fin del periodo de prueba"}`,
        periodStart: start,
        periodEnd: end,
        settings,
      });
      // Como en la pasarela real, el periodo avanza aunque el cobro quede pendiente.
      sub = await this.repo.updateSubscription(sub.id, { current_period_start: start, current_period_end: end });
      const result = await this.charge(sub, invoice, reason, outcome);
      return { result };
    });
  }

  async retryPayment(subscriptionId: string, { outcome }: { outcome?: "approved" | "declined" } = {}) {
    return this.repo.transaction(async () => {
      const sub = await this.repo.getSubscription(subscriptionId);
      if (!sub) throw new BillingError("Suscripción no encontrada.", "not_found");
      if (!["past_due", "grace_period", "unpaid"].includes(sub.status)) throw new BillingError("No hay un cobro pendiente que reintentar.", "nothing_to_retry");
      const open = (await this.repo.listInvoices({ subscriptionId })).find((i) => i.status === "open");
      if (!open) throw new BillingError("No hay un comprobante pendiente.", "nothing_to_retry");
      return { result: await this.charge(sub, open, "retry", outcome) };
    });
  }

  async expireGracePeriod(subscriptionId: string, actorId: string | null = null) {
    return this.repo.transaction(async () => {
      const sub = await this.repo.getSubscription(subscriptionId);
      if (!sub) throw new BillingError("Suscripción no encontrada.", "not_found");
      const { account, plan } = await this.context(sub);
      const updated = await this.applyTransition(sub, "grace_period_expired", {}, { source: "system", actorId });
      await this.notify(account, "payment_reminder", { planName: plan.name });
      return updated;
    });
  }

  // ===========================================================================
  // Operaciones de Administración del espacio
  // ===========================================================================

  private async manageable(actor: Actor, workspaceId: string) {
    assertCanManageBilling(actor, workspaceId);
    const sub = await this.currentSubscription(workspaceId);
    if (!sub) throw new BillingError("Este espacio no tiene una suscripción.", "no_subscription");
    if (sub.workspace_id === null) throw new BillingError("Este espacio se factura de forma centralizada; los cambios los hace la cuenta corporativa.", "central_billing");
    return sub;
  }

  /** «Reintentar pago» con el método predeterminado: la pasarela decide el resultado. */
  async retryPaymentAsUser(actor: Actor, workspaceId: string) {
    const sub = await this.manageable(actor, workspaceId);
    return this.retryPayment(sub.id);
  }

  async scheduleCancellation(actor: Actor, workspaceId: string, reason: string | null) {
    return this.repo.transaction(async () => {
      const sub = await this.manageable(actor, workspaceId);
      const { account, plan } = await this.context(sub);
      const cleanReason = reason?.trim().slice(0, 500) || null;
      if (sub.status === "unpaid") {
        await this.provider.cancelSubscription({ providerSubscriptionId: sub.provider_subscription_id ?? "", atPeriodEnd: false });
        await this.applyTransition(sub, "canceled_immediately", { canceled_at: this.now(), ended_at: this.now(), cancellation_reason: cleanReason }, { source: "user", actorId: actor.userId, payload: { reason: cleanReason } });
        await this.notify(account, "subscription_canceled", { planName: plan.name });
        return { accessUntil: null };
      }
      if (!CANCELABLE.includes(sub.status)) throw new BillingError("Esta suscripción no se puede cancelar en su estado actual.", "not_cancelable");
      if (sub.cancel_at_period_end) throw new BillingError("La cancelación ya está programada.", "already_scheduled");
      await this.provider.cancelSubscription({ providerSubscriptionId: sub.provider_subscription_id ?? "", atPeriodEnd: true });
      const updated = await this.repo.updateSubscription(sub.id, { cancel_at_period_end: true, cancellation_reason: cleanReason });
      for (const c of await this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" })) await this.repo.updateChange(c.id, { status: "canceled" });
      await this.recordEvent(updated, "cancel_scheduled", { source: "user", actorId: actor.userId, payload: { reason: cleanReason, access_until: sub.current_period_end } });
      await this.notify(account, "cancel_scheduled", { planName: plan.name, date: sub.current_period_end ? dateFmt(sub.current_period_end, account.timezone) : undefined });
      return { accessUntil: sub.current_period_end };
    });
  }

  async undoCancellation(actor: Actor, workspaceId: string) {
    return this.repo.transaction(async () => {
      const sub = await this.manageable(actor, workspaceId);
      if (!sub.cancel_at_period_end || TERMINAL.includes(sub.status)) throw new BillingError("No hay una cancelación programada que deshacer.", "nothing_to_undo");
      await this.provider.reactivateSubscription({ providerSubscriptionId: sub.provider_subscription_id ?? "" });
      const updated = await this.repo.updateSubscription(sub.id, { cancel_at_period_end: false, cancellation_reason: null });
      await this.recordEvent(updated, "cancel_undone", { source: "user", actorId: actor.userId });
      const { account, plan } = await this.context(updated);
      await this.notify(account, "subscription_reactivated", { planName: plan.name, date: sub.current_period_end ? dateFmt(sub.current_period_end, account.timezone) : undefined });
      return updated;
    });
  }

  async previewChange(actor: Actor, workspaceId: string, planCode: string, interval: BillingInterval, usage: Usage): Promise<ChangePreview> {
    const sub = await this.manageable(actor, workspaceId);
    const [current, target, settings, allEnts] = await Promise.all([this.repo.getPlan(sub.plan_id), this.repo.getPlanByCode(planCode), this.repo.getSettings(), this.repo.listEntitlements()]);
    if (!current || !target) throw new BillingError("El plan elegido no está disponible.", "plan_unavailable");
    const fromEnts = allEnts.filter((e) => e.plan_id === current.id);
    const toEnts = allEnts.filter((e) => e.plan_id === target.id);
    const same = current.id === target.id && sub.billing_interval === interval;
    const up = target.tier > current.tier || (target.tier === current.tier && sub.billing_interval === "month" && interval === "year");
    const kind: ChangePreview["kind"] = same ? "none" : up ? "upgrade" : "downgrade";
    const immediate = kind === "upgrade" || sub.status === "trialing";
    const newQuote = quote(target, interval, settings);
    let blocked: string | null = null;
    if (!target.is_active) blocked = "El plan elegido no está disponible.";
    else if (target.is_custom_pricing) blocked = "El plan Corporativo se contrata con el equipo comercial.";
    else if (!CHANGEABLE.includes(sub.status)) blocked = "Regulariza el pago o reactiva la suscripción antes de cambiar de plan.";
    else if (sub.cancel_at_period_end) blocked = "Deshaz la cancelación programada antes de cambiar de plan.";
    let proration: Proration | null = null;
    if (!blocked && kind === "upgrade" && sub.status === "active" && newQuote && sub.current_period_start && sub.current_period_end) {
      proration = prorate({
        currentPriceCents: this.priceFor(sub, current, settings),
        newPriceCents: newQuote.periodPriceCents,
        periodStart: sub.current_period_start,
        periodEnd: sub.current_period_end,
        now: this.now(),
        intervalChanges: interval !== sub.billing_interval,
      });
    }
    const limitWarnings: ChangePreview["limitWarnings"] = [];
    for (const code of ["professionals.max", "users.max"] as const) {
      const limit = toEnts.find((e) => e.feature_code === code)?.usage_limit;
      const used = code === "professionals.max" ? usage.professionals : usage.users;
      if (limit !== null && limit !== undefined && used > limit) limitWarnings.push({ code, usage: used, limit });
    }
    return {
      kind,
      currentPlan: current,
      targetPlan: target,
      currentInterval: sub.billing_interval,
      targetInterval: interval,
      effectiveAt: immediate ? this.now() : (sub.current_period_end ?? this.now()),
      immediate,
      proration,
      gained: gainedFeatures(fromEnts, toEnts),
      lost: lostFeatures(fromEnts, toEnts),
      limitWarnings,
      newPeriodPriceCents: newQuote?.periodPriceCents ?? null,
      blocked,
    };
  }

  async changePlan(actor: Actor, workspaceId: string, planCode: string, interval: BillingInterval, usage: Usage) {
    return this.repo.transaction(async () => {
      const preview = await this.previewChange(actor, workspaceId, planCode, interval, usage);
      if (preview.blocked) throw new BillingError(preview.blocked, "change_blocked");
      if (preview.kind === "none") throw new BillingError("Ya tienes ese plan y periodicidad.", "same_plan");
      let sub = (await this.currentSubscription(workspaceId))!;
      const { account, settings } = await this.context(sub);
      const fromPlan = preview.currentPlan;
      const toPlan = preview.targetPlan;

      if (preview.immediate) {
        if (preview.proration && preview.proration.amountDueCents > 0) {
          const invoice = await this.createInvoice({
            account,
            sub,
            priceCents: preview.proration.amountDueCents,
            description: `Cambio a plan ${toPlan.name} · ${INTERVAL_LABEL[interval].toLowerCase()} · diferencia proporcional`,
            periodStart: this.now(),
            periodEnd: preview.proration.restartsPeriod ? addInterval(this.now(), interval) : sub.current_period_end,
            settings,
          });
          await this.charge(sub, invoice, "upgrade");
          const paid = await this.repo.getInvoice(invoice.id);
          if (paid?.status !== "paid") {
            throw new BillingError("La pasarela de demostración rechazó el cobro de la diferencia. Actualiza tu método de pago e inténtalo de nuevo; tu plan no cambió.", "payment_declined");
          }
        }
        await this.provider.changePlan({ providerSubscriptionId: sub.provider_subscription_id ?? "", planCode: toPlan.code, interval, effective: "now" });
        const patch: Partial<SubscriptionRow> = { plan_id: toPlan.id, billing_interval: interval };
        if (preview.proration?.restartsPeriod) Object.assign(patch, { current_period_start: this.now(), current_period_end: addInterval(this.now(), interval) });
        sub = await this.applyTransition(sub, "plan_changed", patch, {
          source: "user",
          actorId: actor.userId,
          payload: { from: fromPlan.code, to: toPlan.code, from_interval: preview.currentInterval, to_interval: interval, proration_cents: preview.proration?.amountDueCents ?? 0 },
        });
        for (const c of await this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" })) await this.repo.updateChange(c.id, { status: "canceled" });
        await this.notify(account, "plan_changed", { planName: toPlan.name, fromPlanName: fromPlan.name, date: dateFmt(this.now(), account.timezone) });
        return { applied: true as const, effectiveAt: this.now(), preview };
      }

      for (const c of await this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" })) await this.repo.updateChange(c.id, { status: "canceled" });
      const change: ChangeRequestRow = {
        id: crypto.randomUUID(),
        subscription_id: sub.id,
        from_plan_id: fromPlan.id,
        to_plan_id: toPlan.id,
        from_interval: preview.currentInterval,
        to_interval: interval,
        kind: "downgrade",
        effective_at: preview.effectiveAt,
        status: "scheduled",
        requested_by: actor.userId,
        created_at: this.now(),
        applied_at: null,
      };
      await this.repo.insertChange(change);
      await this.provider.changePlan({ providerSubscriptionId: sub.provider_subscription_id ?? "", planCode: toPlan.code, interval, effective: "period_end" });
      await this.recordEvent(sub, "plan_change_scheduled", { source: "user", actorId: actor.userId, payload: { from: fromPlan.code, to: toPlan.code, interval, effective_at: change.effective_at, over_limits: preview.limitWarnings } });
      await this.notify(account, "plan_changed", { planName: toPlan.name, fromPlanName: fromPlan.name, date: dateFmt(change.effective_at, account.timezone) });
      return { applied: false as const, effectiveAt: change.effective_at, preview };
    });
  }

  async cancelScheduledChange(actor: Actor, workspaceId: string) {
    return this.repo.transaction(async () => {
      const sub = await this.manageable(actor, workspaceId);
      const [change] = await this.repo.listChanges({ subscriptionId: sub.id, status: "scheduled" });
      if (!change) throw new BillingError("No hay un cambio de plan programado.", "nothing_to_undo");
      await this.repo.updateChange(change.id, { status: "canceled" });
      await this.recordEvent(sub, "plan_change_canceled", { source: "user", actorId: actor.userId, payload: { change: change.id } });
    });
  }

  async addPaymentMethod(actor: Actor, workspaceId: string, cardKey: string, makeDefault = true) {
    assertCanManageBilling(actor, workspaceId);
    const card = findTestCard(cardKey);
    if (!card) throw new BillingError("Elige una de las tarjetas de prueba.", "invalid_card");
    return this.repo.transaction(async () => {
      const account = await this.repo.getAccountByOrganization(workspaceId);
      if (!account) throw new BillingError("Este espacio no tiene una cuenta de facturación.", "no_account");
      const methods = await this.repo.listPaymentMethods(account.id);
      if (methods.length >= 5) throw new BillingError("Puedes guardar hasta 5 métodos de pago.", "too_many_methods");
      const isDefault = makeDefault || !methods.some((m) => m.is_default);
      if (isDefault) for (const m of methods) await this.repo.updatePaymentMethod(m.id, { is_default: false });
      await this.repo.insertPaymentMethod({
        id: crypto.randomUUID(),
        billing_account_id: account.id,
        provider_payment_method_id: `pm_demo_${crypto.randomUUID().slice(0, 12)}`,
        brand: card.brand,
        last4: card.last4,
        exp_month: card.expMonth,
        exp_year: card.expYear,
        is_default: isDefault,
        demo_behavior: card.behavior,
        created_at: this.now(),
      });
      const sub = await this.currentSubscription(workspaceId);
      if (sub) await this.recordEvent(sub, "payment_method_updated", { source: "user", actorId: actor.userId, payload: { brand: card.brand, last4: card.last4, default: isDefault } });
    });
  }

  async setDefaultPaymentMethod(actor: Actor, workspaceId: string, methodId: string) {
    assertCanManageBilling(actor, workspaceId);
    return this.repo.transaction(async () => {
      const account = await this.repo.getAccountByOrganization(workspaceId);
      const methods = account ? await this.repo.listPaymentMethods(account.id) : [];
      if (!methods.some((m) => m.id === methodId)) throw new BillingAccessError();
      for (const m of methods) await this.repo.updatePaymentMethod(m.id, { is_default: m.id === methodId });
    });
  }

  async removePaymentMethod(actor: Actor, workspaceId: string, methodId: string) {
    assertCanManageBilling(actor, workspaceId);
    return this.repo.transaction(async () => {
      const account = await this.repo.getAccountByOrganization(workspaceId);
      const methods = account ? await this.repo.listPaymentMethods(account.id) : [];
      const target = methods.find((m) => m.id === methodId);
      if (!target) throw new BillingAccessError();
      await this.repo.deletePaymentMethod(methodId);
      const rest = methods.filter((m) => m.id !== methodId);
      if (target.is_default && rest.length) await this.repo.updatePaymentMethod(rest[0].id, { is_default: true });
      return { remaining: rest.length };
    });
  }

  async submitLead(input: { name: string; email: string; organization: string; workspaces: number; message: string }) {
    await this.repo.insertLead({ id: crypto.randomUUID(), ...input, created_at: this.now() });
  }

  // ===========================================================================
  // Panel de la plataforma (equipo Wattalis)
  // ===========================================================================

  private async audit(actor: Actor, action: string, targetType: string, targetId: string | null, details: Record<string, unknown> = {}) {
    await this.repo.insertAudit({ id: crypto.randomUUID(), actor_id: actor.userId, action, target_type: targetType, target_id: targetId, details: { ...details, actor_email: actor.email }, created_at: this.now() });
  }

  async adminDashboard(actor: Actor) {
    assertPlatformStaff(actor);
    const [plans, entitlements, settings, accounts, subscriptions, invoices, attempts, events, audit, leads, notifications] = await Promise.all([
      this.repo.listPlans(),
      this.repo.listEntitlements(),
      this.repo.getSettings(),
      this.repo.listAccounts(),
      this.repo.listSubscriptions(),
      this.repo.listInvoices(),
      this.repo.listAttempts(),
      this.repo.listEvents({ limit: 400 }),
      this.repo.listAudit(100),
      this.repo.listLeads(),
      this.repo.listNotifications({ limit: 60 }),
    ]);
    const allEvents = await this.repo.listEvents();
    const metrics = computeMetrics({ now: this.now(), plans, settings, accounts, subscriptions, invoices, attempts, events: allEvents });
    const customers = accounts
      .map((account) => {
        const subs = subscriptions.filter((s) => s.billing_account_id === account.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const sub = subs.find((s) => !TERMINAL.includes(s.status)) ?? subs[0] ?? null;
        const plan = sub ? plans.find((p) => p.id === sub.plan_id) ?? null : null;
        return { account, subscription: sub, plan, mrrCents: sub ? metrics.mrrBySubscription[sub.id] ?? 0 : 0, openInvoices: invoices.filter((i) => i.billing_account_id === account.id && i.status === "open").length };
      })
      .sort((a, b) => a.account.legal_name.localeCompare(b.account.legal_name, "es"));
    return { plans, entitlements, settings, metrics, customers, events, audit, leads, notifications, providerLive: this.provider.live };
  }

  async adminUpdatePlan(actor: Actor, planId: string, patch: { name?: string; description?: string; monthly_price_cents?: number | null; badge?: string | null; is_active?: boolean }) {
    assertPlatformAdmin(actor);
    return this.repo.transaction(async () => {
      const plan = await this.repo.getPlan(planId);
      if (!plan) throw new BillingError("Plan no encontrado.", "not_found");
      const settings = await this.repo.getSettings();
      const next: Partial<PlanRow> = {};
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name.length < 2 || name.length > 60) throw new BillingError("El nombre debe tener entre 2 y 60 caracteres.", "invalid_plan");
        next.name = name;
      }
      if (patch.description !== undefined) next.description = patch.description.trim().slice(0, 300);
      if (patch.badge !== undefined) next.badge = patch.badge?.trim().slice(0, 30) || null;
      if (patch.is_active !== undefined) next.is_active = patch.is_active;
      if (patch.monthly_price_cents !== undefined && !plan.is_custom_pricing) {
        const cents = patch.monthly_price_cents;
        if (cents === null || !Number.isInteger(cents) || cents < 0 || cents > 100_000_000) throw new BillingError("Escribe un precio válido.", "invalid_price");
        next.monthly_price_cents = cents;
        next.annual_price_cents = annualFromMonthly(cents, settings.annual_discount_bps);
      }
      const updated = await this.repo.updatePlan(planId, next);
      await this.audit(actor, "plan.updated", "subscription_plan", planId, { before: pick(plan, Object.keys(next)), after: next });
      return updated;
    });
  }

  async adminUpdateEntitlements(actor: Actor, planId: string, entries: { feature_code: string; enabled: boolean; usage_limit: number | null }[]) {
    assertPlatformAdmin(actor);
    return this.repo.transaction(async () => {
      if (!(await this.repo.getPlan(planId))) throw new BillingError("Plan no encontrado.", "not_found");
      for (const e of entries) {
        const def = FEATURE_BY_CODE[e.feature_code];
        if (!def) throw new BillingError(`Función desconocida: ${e.feature_code}`, "invalid_feature");
        if (e.usage_limit !== null && (!Number.isInteger(e.usage_limit) || e.usage_limit < 0 || e.usage_limit > 100_000)) throw new BillingError("Los límites deben ser enteros positivos.", "invalid_limit");
      }
      const known = new Set(entries.map((e) => e.feature_code));
      const before = await this.repo.listEntitlements(planId);
      const rows = FEATURES.map((f) => {
        const e = entries.find((x) => x.feature_code === f.code);
        const prev = before.find((x) => x.feature_code === f.code);
        return { feature_code: f.code, enabled: e ? e.enabled : (prev?.enabled ?? false), usage_limit: f.kind === "limit" ? (e && known.has(f.code) ? e.usage_limit : (prev?.usage_limit ?? null)) : null };
      }).filter((r) => r.enabled || FEATURE_BY_CODE[r.feature_code].kind === "limit");
      await this.repo.replaceEntitlements(planId, rows);
      await this.audit(actor, "plan.entitlements_updated", "subscription_plan", planId, { entitlements: rows });
    });
  }

  async adminUpdateSettings(actor: Actor, patch: Partial<Pick<BillingSettingsRow, "annual_discount_bps" | "grace_period_days" | "tax_rate_bps" | "prices_include_tax" | "trial_days" | "enforce_limits">>) {
    assertPlatformAdmin(actor);
    const int = (v: number | undefined, min: number, max: number, label: string) => {
      if (v !== undefined && (!Number.isInteger(v) || v < min || v > max)) throw new BillingError(`${label} fuera de rango.`, "invalid_setting");
    };
    int(patch.annual_discount_bps, 0, 5000, "El descuento anual");
    int(patch.grace_period_days, 0, 60, "El periodo de gracia");
    int(patch.tax_rate_bps, 0, 3000, "La tasa de IVA");
    int(patch.trial_days, 0, 90, "El periodo de prueba");
    return this.repo.transaction(async () => {
      const before = await this.repo.getSettings();
      const updated = await this.repo.updateSettings({ ...patch, updated_by: actor.userId });
      if (patch.annual_discount_bps !== undefined && patch.annual_discount_bps !== before.annual_discount_bps) {
        for (const plan of await this.repo.listPlans()) {
          if (plan.monthly_price_cents !== null) await this.repo.updatePlan(plan.id, { annual_price_cents: annualFromMonthly(plan.monthly_price_cents, patch.annual_discount_bps) });
        }
      }
      await this.audit(actor, "settings.updated", "billing_settings", null, { before: pick(before, Object.keys(patch)), after: patch });
      return updated;
    });
  }

  async adminSimulate(actor: Actor, subscriptionId: string, action: SimulationAction) {
    assertPlatformAdmin(actor);
    this.simulator();
    const sub = await this.repo.getSubscription(subscriptionId);
    if (!sub) throw new BillingError("Suscripción no encontrada.", "not_found");
    let result: unknown;
    switch (action) {
      case "renew_approved":
      case "renew_declined":
        result = await this.runRenewal(subscriptionId, { outcome: action === "renew_approved" ? "approved" : "declined", actorId: actor.userId });
        break;
      case "retry_approved":
      case "retry_declined":
        result = await this.retryPayment(subscriptionId, { outcome: action === "retry_approved" ? "approved" : "declined" });
        break;
      case "expire_grace":
        result = await this.expireGracePeriod(subscriptionId, actor.userId);
        break;
      case "cancel_now": {
        const { rawBody, signature } = this.simulator().signEvent({ type: "subscription.canceled", data: { subscriptionId } });
        result = await this.processWebhook(rawBody, signature);
        break;
      }
      case "notify_trial_ending": {
        if (sub.status !== "trialing") throw new BillingError("La suscripción no está en periodo de prueba.", "not_trialing");
        const { rawBody, signature } = this.simulator().signEvent({ type: "subscription.trial_ending", data: { subscriptionId } });
        result = await this.processWebhook(rawBody, signature);
        break;
      }
      case "notify_renewal": {
        const { account, plan, settings } = await this.context(sub);
        await this.notify(account, "renewal_upcoming", { planName: plan.name, amountCents: taxBreakdown(this.priceFor(sub, plan, settings), settings).totalCents, date: sub.current_period_end ? dateFmt(sub.current_period_end, account.timezone) : undefined });
        result = { notified: true };
        break;
      }
    }
    await this.audit(actor, `simulation.${action}`, "subscription", subscriptionId, { status_before: sub.status });
    return result;
  }

  async adminReset(actor: Actor) {
    assertPlatformAdmin(actor);
    await this.resetDemoData();
    await this.audit(actor, "demo.reset", "billing", null);
  }

  /** Solo demostración: vuelve a los datos ficticios iniciales (también lo usa «Reiniciar datos»). */
  async resetDemoData() {
    if (!this.repo.reset || this.provider.live) throw new BillingError("El reinicio solo existe en la demostración.", "not_demo");
    await this.repo.reset();
  }
}

function pick<T extends object>(obj: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
}

export type { Entitlements, PlanEntitlementRow };
