// Contrato con la pasarela de pagos. Es independiente de AWS: la pasarela real
// (Stripe Checkout u otra) será la fuente autorizada de los cobros, y Wattalis
// solo cambia el estado de una suscripción al procesar sus eventos firmados.
import type { BillingInterval, ProviderName } from "../types";

export type ProviderCheckoutOutcome = "approved" | "declined" | "pending" | "canceled";

/** Evento normalizado que llega de la pasarela (webhook), ya con la firma verificada. */
export type BillingWebhookEvent = {
  /** Identificador único del evento en la pasarela: base de la idempotencia. */
  id: string;
  type:
    | "checkout.completed"
    | "checkout.failed"
    | "checkout.pending"
    | "checkout.canceled"
    | "checkout.expired"
    | "invoice.paid"
    | "invoice.payment_failed"
    | "subscription.trial_ending"
    | "subscription.period_ended"
    | "subscription.canceled";
  created: string;
  data: {
    checkoutSessionId?: string;
    subscriptionId?: string;
    providerSubscriptionId?: string;
    invoiceId?: string;
    amountCents?: number;
    paymentId?: string;
    failureReason?: string;
    /** Por qué se generó el cobro. */
    reason?: "checkout" | "renewal" | "retry" | "trial_conversion" | "upgrade" | "reactivation";
    /** Método usado en la pasarela: solo datos no sensibles (marca y terminación). */
    paymentMethod?: { id: string; brand: string; last4: string; expMonth: number; expYear: number };
  };
};

export type ProviderInvoice = { id: string; amountCents: number; status: "paid" | "open" | "void" | "uncollectible"; createdAt: string };

export interface BillingProvider {
  readonly name: ProviderName;
  /** false: no se mueve dinero real (modo demostración). */
  readonly live: boolean;

  createCustomer(input: { billingAccountId: string; email: string; name: string }): Promise<{ customerId: string }>;
  /** Sesión de pago alojada por la pasarela. Nunca se capturan datos de tarjeta en Wattalis. */
  createCheckoutSession(input: {
    customerId: string;
    billingAccountId: string;
    subscriptionId: string;
    planCode: string;
    interval: BillingInterval;
    amountCents: number;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; url: string; expiresAt: string }>;
  createSubscription(input: { customerId: string; planCode: string; interval: BillingInterval; trialDays?: number }): Promise<{ providerSubscriptionId: string }>;
  getSubscription(providerSubscriptionId: string): Promise<{ id: string; status: string } | null>;
  /** En la pasarela real, `effective: "now"` genera el prorrateo. */
  changePlan(input: { providerSubscriptionId: string; planCode: string; interval: BillingInterval; effective: "now" | "period_end" }): Promise<void>;
  cancelSubscription(input: { providerSubscriptionId: string; atPeriodEnd: boolean }): Promise<void>;
  reactivateSubscription(input: { providerSubscriptionId: string }): Promise<{ providerSubscriptionId: string }>;
  getInvoices(customerId: string): Promise<ProviderInvoice[]>;
  /** Portal de la pasarela para que el cliente gestione sus tarjetas. */
  getCustomerPortalUrl(input: { customerId: string; returnUrl: string }): Promise<string>;
  /** Verifica la firma y normaliza el evento. Rechaza firmas inválidas. */
  handleWebhook(rawBody: string, signature: string | null): Promise<BillingWebhookEvent>;
}

export class WebhookSignatureError extends Error {
  readonly domain = "billing";
  readonly code = "invalid_signature";
  constructor() {
    super("Firma del evento inválida.");
  }
}

export class ProviderNotConfiguredError extends Error {
  readonly domain = "billing";
  readonly code = "provider_not_configured";
}

/**
 * Error esperado del módulo de facturación (permiso, regla de negocio, firma…).
 * Se reconoce por su marca y no con instanceof: Next empaqueta rutas, páginas y
 * acciones por separado y la clase puede venir de otra copia del módulo.
 */
export function billingErrorOf(error: unknown): { code: string; message: string } | null {
  if (error instanceof Error && (error as { domain?: unknown }).domain === "billing") {
    return { code: String((error as { code?: unknown }).code ?? "billing_error"), message: error.message };
  }
  return null;
}
