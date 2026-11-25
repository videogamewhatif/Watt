// Tipos del módulo de suscripciones. Las filas usan los mismos nombres de columna
// que supabase/migrations/20261125090000_subscriptions.sql (snake_case), para que
// un repositorio PostgreSQL (RDS) pueda devolverlas sin transformar.
// Todos los importes son centavos enteros (MXN).

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "grace_period" | "unpaid" | "canceled" | "expired" | "incomplete";
export type BillingInterval = "month" | "year";
export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible";
export type PaymentAttemptStatus = "pending" | "succeeded" | "failed" | "canceled";
export type ChangeRequestStatus = "scheduled" | "applied" | "canceled";
export type ChangeKind = "upgrade" | "downgrade";
export type EventSource = "provider" | "system" | "user" | "platform_admin";
export type ProviderName = "mock" | "stripe";
export type PlatformRole = "platform_admin" | "billing_support";

type Stamps = { created_at: string; updated_at: string };

export type PlanRow = Stamps & {
  id: string;
  code: string;
  name: string;
  /** A quién va dirigido («Para clínicas pequeñas»). */
  description: string;
  /** null = precio personalizado (Corporativo). */
  monthly_price_cents: number | null;
  annual_price_cents: number | null;
  currency: "MXN";
  is_active: boolean;
  is_custom_pricing: boolean;
  /** Etiqueta destacada en la tarjeta («Más popular»). */
  badge: string | null;
  /** Rango para distinguir mejora (sube) de reducción (baja). */
  tier: number;
  display_order: number;
};

export type PlanEntitlementRow = {
  id: string;
  plan_id: string;
  feature_code: string;
  enabled: boolean;
  /** Solo para límites. null = sin límite / personalizado. */
  usage_limit: number | null;
  created_at: string;
};

export type BillingSettingsRow = {
  /** Descuento anual en puntos base (1500 = 15 %). */
  annual_discount_bps: number;
  grace_period_days: number;
  /** IVA en puntos base (1600 = 16 %). */
  tax_rate_bps: number;
  prices_include_tax: boolean;
  trial_days: number;
  /** Si es false los límites solo se informan (no bloquean). */
  enforce_limits: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type BillingAccountRow = Stamps & {
  id: string;
  /** Espacio (organización) dueño de la cuenta de facturación. */
  organization_id: string;
  legal_name: string;
  billing_email: string;
  contact_name: string;
  phone: string | null;
  country: string;
  timezone: string;
  establishment_type: string | null;
  provider: ProviderName;
  provider_customer_id: string | null;
};

/** Espacios cubiertos por una cuenta central (facturación corporativa, preparado). */
export type BillingAccountWorkspaceRow = { billing_account_id: string; workspace_id: string; created_at: string };

export type SubscriptionRow = Stamps & {
  id: string;
  billing_account_id: string;
  /** Espacio que cubre. null = suscripción central de la cuenta (Corporativo). */
  workspace_id: string | null;
  plan_id: string;
  provider_subscription_id: string | null;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  cancellation_reason: string | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  ended_at: string | null;
  /** Precio pactado (Corporativo) en centavos por periodo; null = precio del plan. */
  custom_price_cents: number | null;
};

export type SubscriptionEventRow = {
  id: string;
  subscription_id: string;
  event_type: string;
  source: EventSource;
  provider_event_id: string | null;
  actor_id: string | null;
  from_status: SubscriptionStatus | null;
  to_status: SubscriptionStatus | null;
  payload: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
};

export type InvoiceRow = {
  id: string;
  billing_account_id: string;
  subscription_id: string | null;
  invoice_reference: string;
  description: string;
  subtotal_cents: number;
  tax_cents: number;
  amount_cents: number;
  currency: "MXN";
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  issued_at: string;
  paid_at: string | null;
  provider_invoice_id: string | null;
  /** Comprobante de demostración: nunca es un CFDI ni un cobro real. */
  is_demo: boolean;
};

export type PaymentAttemptRow = {
  id: string;
  subscription_id: string | null;
  invoice_id: string;
  provider_payment_id: string | null;
  amount_cents: number;
  status: PaymentAttemptStatus;
  failure_reason: string | null;
  attempted_at: string;
};

export type ChangeRequestRow = {
  id: string;
  subscription_id: string;
  from_plan_id: string;
  to_plan_id: string;
  from_interval: BillingInterval;
  to_interval: BillingInterval;
  kind: ChangeKind;
  effective_at: string;
  status: ChangeRequestStatus;
  requested_by: string | null;
  created_at: string;
  applied_at: string | null;
};

/** Solo datos no sensibles: nunca número completo, CVV ni datos bancarios. */
export type PaymentMethodRow = {
  id: string;
  billing_account_id: string;
  provider_payment_method_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  /** Comportamiento de la tarjeta de prueba al cobrar (solo modo demostración). */
  demo_behavior: "approve" | "decline";
  created_at: string;
};

export type NotificationRow = {
  id: string;
  billing_account_id: string | null;
  organization_id: string | null;
  template: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  /** demo_not_sent: se muestra en la bandeja; no sale ningún correo. */
  status: "demo_not_sent" | "queued" | "sent" | "failed";
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type SalesLeadRow = {
  id: string;
  name: string;
  email: string;
  organization: string;
  workspaces: number;
  message: string;
  created_at: string;
};

/** Sesión de pago creada en la pasarela (en demostración, la simula el proveedor mock). */
export type CheckoutSessionRow = {
  id: string;
  billing_account_id: string;
  subscription_id: string;
  plan_id: string;
  billing_interval: BillingInterval;
  amount_cents: number;
  status: "open" | "completed" | "failed" | "pending" | "canceled" | "expired";
  failure_reason: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
};

/** Quién pide la operación. Las membresías vienen de la sesión validada en el servidor. */
export type Actor = {
  userId: string;
  email: string;
  memberships: { organizationId: string; role: "admin" | "reception" | "professional" }[];
  platformRole: PlatformRole | null;
};
