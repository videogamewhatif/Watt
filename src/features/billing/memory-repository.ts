// Repositorio en memoria del proceso para la DEMOSTRACIÓN. Los datos son
// ficticios, se pierden al reiniciar el servidor y se pueden reiniciar desde la
// interfaz. Nunca se mezclan con pagos de producción.
import { AsyncLocalStorage } from "node:async_hooks";
import type { BillingData, BillingRepository, CheckoutSessionRecord } from "./repository";
import type { BillingSettingsRow, ChangeRequestRow, PlanEntitlementRow } from "./types";

const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();

function notFound(what: string): never {
  throw new Error(`${what} no encontrado`);
}

/** Más reciente primero; a igual fecha, el último insertado primero (orden estable). */
function newestFirst<T>(rows: T[], key: (row: T) => string): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => key(b.row).localeCompare(key(a.row)) || b.i - a.i)
    .map((x) => x.row);
}

export class InMemoryBillingRepository implements BillingRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly inTransaction = new AsyncLocalStorage<true>();

  constructor(
    private data: BillingData,
    private readonly seed: () => BillingData,
  ) {}

  /**
   * Serializa las escrituras: dos solicitudes simultáneas (p. ej. un doble clic o
   * el mismo evento entregado dos veces) no se intercalan. Las llamadas anidadas
   * dentro de la misma transacción se ejecutan directamente.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction.getStore()) return fn();
    const run = this.queue.then(() => this.inTransaction.run(true, fn));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async reset() {
    this.data = this.seed();
  }

  /** Para pruebas: acceso directo a las filas. */
  get raw(): BillingData {
    return this.data;
  }

  async getSettings() {
    return clone(this.data.settings);
  }
  async updateSettings(patch: Partial<BillingSettingsRow>) {
    this.data.settings = { ...this.data.settings, ...patch, updated_at: now() };
    return clone(this.data.settings);
  }

  async listPlans() {
    return clone([...this.data.plans].sort((a, b) => a.display_order - b.display_order));
  }
  async getPlan(id: string) {
    return clone(this.data.plans.find((p) => p.id === id) ?? null);
  }
  async getPlanByCode(code: string) {
    return clone(this.data.plans.find((p) => p.code === code) ?? null);
  }
  async updatePlan(id: string, patch: Partial<typeof this.data.plans[number]>) {
    const plan = this.data.plans.find((p) => p.id === id) ?? notFound("Plan");
    Object.assign(plan, patch, { updated_at: now() });
    return clone(plan);
  }
  async listEntitlements(planId?: string) {
    return clone(this.data.plan_entitlements.filter((e) => !planId || e.plan_id === planId));
  }
  async replaceEntitlements(planId: string, rows: Omit<PlanEntitlementRow, "id" | "created_at" | "plan_id">[]) {
    this.data.plan_entitlements = [
      ...this.data.plan_entitlements.filter((e) => e.plan_id !== planId),
      ...rows.map((r) => ({ ...r, id: crypto.randomUUID(), plan_id: planId, created_at: now() })),
    ];
  }

  async listAccounts() {
    return clone(this.data.billing_accounts);
  }
  async getAccount(id: string) {
    return clone(this.data.billing_accounts.find((a) => a.id === id) ?? null);
  }
  async getAccountByOrganization(organizationId: string) {
    return clone(this.data.billing_accounts.find((a) => a.organization_id === organizationId) ?? null);
  }
  async getAccountForWorkspace(workspaceId: string) {
    const own = this.data.billing_accounts.find((a) => a.organization_id === workspaceId);
    if (own) return clone(own);
    const link = this.data.billing_account_workspaces.find((l) => l.workspace_id === workspaceId);
    return clone(link ? (this.data.billing_accounts.find((a) => a.id === link.billing_account_id) ?? null) : null);
  }
  async insertAccount(row: BillingData["billing_accounts"][number]) {
    if (this.data.billing_accounts.some((a) => a.organization_id === row.organization_id)) throw new Error("duplicate_billing_account");
    this.data.billing_accounts.push(clone(row));
    return clone(row);
  }
  async updateAccount(id: string, patch: Partial<BillingData["billing_accounts"][number]>) {
    const account = this.data.billing_accounts.find((a) => a.id === id) ?? notFound("Cuenta");
    Object.assign(account, patch, { updated_at: now() });
    return clone(account);
  }

  async listSubscriptions(filter: { billingAccountId?: string; workspaceId?: string } = {}) {
    return clone(
      this.data.subscriptions.filter(
        (s) => (!filter.billingAccountId || s.billing_account_id === filter.billingAccountId) && (!filter.workspaceId || s.workspace_id === filter.workspaceId),
      ),
    );
  }
  async getSubscription(id: string) {
    return clone(this.data.subscriptions.find((s) => s.id === id) ?? null);
  }
  async insertSubscription(row: BillingData["subscriptions"][number]) {
    // Equivale al índice único parcial subscriptions_one_current_per_workspace.
    const current = this.data.subscriptions.some((s) => s.workspace_id && s.workspace_id === row.workspace_id && !["canceled", "expired"].includes(s.status));
    if (current) throw new Error("duplicate_current_subscription");
    this.data.subscriptions.push(clone(row));
    return clone(row);
  }
  async updateSubscription(id: string, patch: Partial<BillingData["subscriptions"][number]>) {
    const sub = this.data.subscriptions.find((s) => s.id === id) ?? notFound("Suscripción");
    Object.assign(sub, patch, { updated_at: now() });
    return clone(sub);
  }

  async insertEvent(row: BillingData["subscription_events"][number]) {
    if (row.provider_event_id && this.data.subscription_events.some((e) => e.provider_event_id === row.provider_event_id)) throw new Error("duplicate_provider_event");
    this.data.subscription_events.push(clone(row));
  }
  async listEvents(filter: { subscriptionId?: string; subscriptionIds?: string[]; limit?: number } = {}) {
    const ids = filter.subscriptionIds ? new Set(filter.subscriptionIds) : null;
    const rows = newestFirst(
      this.data.subscription_events.filter((e) => (!filter.subscriptionId || e.subscription_id === filter.subscriptionId) && (!ids || ids.has(e.subscription_id))),
      (e) => e.created_at,
    );
    return clone(filter.limit ? rows.slice(0, filter.limit) : rows);
  }
  async hasProviderEvent(providerEventId: string) {
    return this.data.subscription_events.some((e) => e.provider_event_id === providerEventId);
  }

  async nextInvoiceReference(issuedAt: string) {
    this.data.invoice_seq += 1;
    return `DEMO-${issuedAt.slice(0, 4)}-${String(this.data.invoice_seq).padStart(6, "0")}`;
  }
  async insertInvoice(row: BillingData["billing_invoices"][number]) {
    if (row.amount_cents !== row.subtotal_cents + row.tax_cents || row.amount_cents < 0) throw new Error("invalid_invoice_amount");
    this.data.billing_invoices.push(clone(row));
    return clone(row);
  }
  async updateInvoice(id: string, patch: Partial<BillingData["billing_invoices"][number]>) {
    const invoice = this.data.billing_invoices.find((i) => i.id === id) ?? notFound("Comprobante");
    Object.assign(invoice, patch);
    return clone(invoice);
  }
  async getInvoice(id: string) {
    return clone(this.data.billing_invoices.find((i) => i.id === id) ?? null);
  }
  async listInvoices(filter: { billingAccountId?: string; subscriptionId?: string } = {}) {
    return clone(
      newestFirst(
        this.data.billing_invoices.filter((i) => (!filter.billingAccountId || i.billing_account_id === filter.billingAccountId) && (!filter.subscriptionId || i.subscription_id === filter.subscriptionId)),
        (i) => i.issued_at,
      ),
    );
  }

  async insertAttempt(row: BillingData["payment_attempts"][number]) {
    this.data.payment_attempts.push(clone(row));
  }
  async listAttempts(filter: { subscriptionId?: string; invoiceId?: string } = {}) {
    return clone(
      newestFirst(
        this.data.payment_attempts.filter((a) => (!filter.subscriptionId || a.subscription_id === filter.subscriptionId) && (!filter.invoiceId || a.invoice_id === filter.invoiceId)),
        (a) => a.attempted_at,
      ),
    );
  }

  async insertChange(row: ChangeRequestRow) {
    if (row.status === "scheduled" && this.data.subscription_change_requests.some((c) => c.subscription_id === row.subscription_id && c.status === "scheduled")) {
      throw new Error("duplicate_scheduled_change");
    }
    this.data.subscription_change_requests.push(clone(row));
  }
  async updateChange(id: string, patch: Partial<ChangeRequestRow>) {
    const change = this.data.subscription_change_requests.find((c) => c.id === id) ?? notFound("Cambio");
    Object.assign(change, patch);
  }
  async listChanges(filter: { subscriptionId?: string; status?: ChangeRequestRow["status"] }) {
    return clone(
      newestFirst(
        this.data.subscription_change_requests.filter((c) => (!filter.subscriptionId || c.subscription_id === filter.subscriptionId) && (!filter.status || c.status === filter.status)),
        (c) => c.created_at,
      ),
    );
  }

  async listPaymentMethods(billingAccountId: string) {
    return clone(this.data.billing_payment_methods.filter((m) => m.billing_account_id === billingAccountId).sort((a, b) => Number(b.is_default) - Number(a.is_default)));
  }
  async insertPaymentMethod(row: BillingData["billing_payment_methods"][number]) {
    if (!/^\d{4}$/.test(row.last4)) throw new Error("invalid_payment_method");
    this.data.billing_payment_methods.push(clone(row));
  }
  async updatePaymentMethod(id: string, patch: Partial<BillingData["billing_payment_methods"][number]>) {
    const method = this.data.billing_payment_methods.find((m) => m.id === id) ?? notFound("Método de pago");
    Object.assign(method, patch);
  }
  async deletePaymentMethod(id: string) {
    this.data.billing_payment_methods = this.data.billing_payment_methods.filter((m) => m.id !== id);
  }

  async insertNotification(row: BillingData["billing_notifications"][number]) {
    this.data.billing_notifications.push(clone(row));
  }
  async listNotifications(filter: { organizationId?: string; billingAccountId?: string; limit?: number } = {}) {
    const rows = newestFirst(
      this.data.billing_notifications.filter((n) => (!filter.organizationId || n.organization_id === filter.organizationId) && (!filter.billingAccountId || n.billing_account_id === filter.billingAccountId)),
      (n) => n.created_at,
    );
    return clone(filter.limit ? rows.slice(0, filter.limit) : rows);
  }

  async insertAudit(row: BillingData["billing_audit_log"][number]) {
    this.data.billing_audit_log.push(clone(row));
  }
  async listAudit(limit = 100) {
    return clone(newestFirst(this.data.billing_audit_log, (a) => a.created_at).slice(0, limit));
  }

  async insertLead(row: BillingData["sales_leads"][number]) {
    this.data.sales_leads.push(clone(row));
  }
  async listLeads() {
    return clone(newestFirst(this.data.sales_leads, (l) => l.created_at));
  }

  async insertCheckout(row: CheckoutSessionRecord) {
    this.data.checkout_sessions.push(clone(row));
  }
  async getCheckout(id: string) {
    return clone(this.data.checkout_sessions.find((c) => c.id === id) ?? null);
  }
  async findCheckoutByKey(idempotencyKey: string) {
    return clone(this.data.checkout_sessions.find((c) => c.idempotency_key === idempotencyKey) ?? null);
  }
  async updateCheckout(id: string, patch: Partial<CheckoutSessionRecord>) {
    const row = this.data.checkout_sessions.find((c) => c.id === id) ?? notFound("Sesión de pago");
    Object.assign(row, patch);
  }
}
