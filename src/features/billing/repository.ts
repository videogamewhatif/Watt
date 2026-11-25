// Acceso a datos de facturación. El contrato es asíncrono y por tabla para que
// una implementación PostgreSQL (Amazon RDS, conexión privilegiada desde el
// servidor o una Lambda) lo cumpla sin cambiar el servicio. La implementación
// activa en la demostración es InMemoryBillingRepository.
import type {
  AuditLogRow,
  BillingAccountRow,
  BillingAccountWorkspaceRow,
  BillingSettingsRow,
  ChangeRequestRow,
  CheckoutSessionRow,
  InvoiceRow,
  NotificationRow,
  PaymentAttemptRow,
  PaymentMethodRow,
  PlanEntitlementRow,
  PlanRow,
  SalesLeadRow,
  SubscriptionEventRow,
  SubscriptionRow,
} from "./types";

export type BillingData = {
  settings: BillingSettingsRow;
  plans: PlanRow[];
  plan_entitlements: PlanEntitlementRow[];
  billing_accounts: BillingAccountRow[];
  billing_account_workspaces: BillingAccountWorkspaceRow[];
  subscriptions: SubscriptionRow[];
  subscription_events: SubscriptionEventRow[];
  billing_invoices: InvoiceRow[];
  payment_attempts: PaymentAttemptRow[];
  subscription_change_requests: ChangeRequestRow[];
  billing_payment_methods: PaymentMethodRow[];
  billing_notifications: NotificationRow[];
  billing_audit_log: AuditLogRow[];
  sales_leads: SalesLeadRow[];
  checkout_sessions: (CheckoutSessionRow & { idempotency_key: string; provider_session_id: string; invoice_id: string })[];
  /** Consecutivo de referencias de comprobante. */
  invoice_seq: number;
};

export type CheckoutSessionRecord = BillingData["checkout_sessions"][number];

export interface BillingRepository {
  /** Ejecuta fn sin intercalarse con otra escritura (en PostgreSQL: una transacción). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  getSettings(): Promise<BillingSettingsRow>;
  updateSettings(patch: Partial<BillingSettingsRow>): Promise<BillingSettingsRow>;

  listPlans(): Promise<PlanRow[]>;
  getPlan(id: string): Promise<PlanRow | null>;
  getPlanByCode(code: string): Promise<PlanRow | null>;
  updatePlan(id: string, patch: Partial<PlanRow>): Promise<PlanRow>;
  listEntitlements(planId?: string): Promise<PlanEntitlementRow[]>;
  replaceEntitlements(planId: string, rows: Omit<PlanEntitlementRow, "id" | "created_at" | "plan_id">[]): Promise<void>;

  listAccounts(): Promise<BillingAccountRow[]>;
  getAccount(id: string): Promise<BillingAccountRow | null>;
  getAccountByOrganization(organizationId: string): Promise<BillingAccountRow | null>;
  /** Cuenta que factura un espacio: la propia o la central a la que está vinculado. */
  getAccountForWorkspace(workspaceId: string): Promise<BillingAccountRow | null>;
  insertAccount(row: BillingAccountRow): Promise<BillingAccountRow>;
  updateAccount(id: string, patch: Partial<BillingAccountRow>): Promise<BillingAccountRow>;

  listSubscriptions(filter?: { billingAccountId?: string; workspaceId?: string }): Promise<SubscriptionRow[]>;
  getSubscription(id: string): Promise<SubscriptionRow | null>;
  insertSubscription(row: SubscriptionRow): Promise<SubscriptionRow>;
  updateSubscription(id: string, patch: Partial<SubscriptionRow>): Promise<SubscriptionRow>;

  insertEvent(row: SubscriptionEventRow): Promise<void>;
  listEvents(filter?: { subscriptionId?: string; subscriptionIds?: string[]; limit?: number }): Promise<SubscriptionEventRow[]>;
  hasProviderEvent(providerEventId: string): Promise<boolean>;

  nextInvoiceReference(issuedAt: string): Promise<string>;
  insertInvoice(row: InvoiceRow): Promise<InvoiceRow>;
  updateInvoice(id: string, patch: Partial<InvoiceRow>): Promise<InvoiceRow>;
  getInvoice(id: string): Promise<InvoiceRow | null>;
  listInvoices(filter?: { billingAccountId?: string; subscriptionId?: string }): Promise<InvoiceRow[]>;

  insertAttempt(row: PaymentAttemptRow): Promise<void>;
  listAttempts(filter?: { subscriptionId?: string; invoiceId?: string }): Promise<PaymentAttemptRow[]>;

  insertChange(row: ChangeRequestRow): Promise<void>;
  updateChange(id: string, patch: Partial<ChangeRequestRow>): Promise<void>;
  listChanges(filter: { subscriptionId?: string; status?: ChangeRequestRow["status"] }): Promise<ChangeRequestRow[]>;

  listPaymentMethods(billingAccountId: string): Promise<PaymentMethodRow[]>;
  insertPaymentMethod(row: PaymentMethodRow): Promise<void>;
  updatePaymentMethod(id: string, patch: Partial<PaymentMethodRow>): Promise<void>;
  deletePaymentMethod(id: string): Promise<void>;

  insertNotification(row: NotificationRow): Promise<void>;
  listNotifications(filter?: { organizationId?: string; billingAccountId?: string; limit?: number }): Promise<NotificationRow[]>;

  insertAudit(row: AuditLogRow): Promise<void>;
  listAudit(limit?: number): Promise<AuditLogRow[]>;

  insertLead(row: SalesLeadRow): Promise<void>;
  listLeads(): Promise<SalesLeadRow[]>;

  insertCheckout(row: CheckoutSessionRecord): Promise<void>;
  getCheckout(id: string): Promise<CheckoutSessionRecord | null>;
  findCheckoutByKey(idempotencyKey: string): Promise<CheckoutSessionRecord | null>;
  updateCheckout(id: string, patch: Partial<CheckoutSessionRecord>): Promise<void>;

  /** Solo demostración: vuelve a los datos iniciales. */
  reset?(): Promise<void>;
}
