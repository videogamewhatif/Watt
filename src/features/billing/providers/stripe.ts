// Implementación FUTURA para Stripe. Está deshabilitada: no hay credenciales, no
// se importa el SDK y ninguna operación llega a Stripe. Documenta el mapeo para
// conectar la pasarela real sin tocar el resto del módulo.
//
// Mapeo previsto (API de Stripe):
//   createCustomer          → customers.create({ email, name, metadata: { billing_account_id } })
//   createCheckoutSession   → checkout.sessions.create({ mode: "subscription", customer, line_items: [{ price }],
//                               success_url, cancel_url, subscription_data: { metadata } }, { idempotencyKey })
//   createSubscription      → subscriptions.create (solo altas sin Checkout, p. ej. Corporativo)
//   getSubscription         → subscriptions.retrieve
//   changePlan              → subscriptions.update({ items, proration_behavior: "create_prorations" }) para mejoras;
//                             subscriptionSchedules para reducciones al final del periodo
//   cancelSubscription      → subscriptions.update({ cancel_at_period_end: true }) o subscriptions.cancel
//   reactivateSubscription  → subscriptions.update({ cancel_at_period_end: false }) o nueva suscripción
//   getInvoices             → invoices.list({ customer })
//   getCustomerPortalUrl    → billingPortal.sessions.create({ customer, return_url })
//   handleWebhook           → webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET) y normalizar:
//                               checkout.session.completed  → checkout.completed
//                               invoice.paid                → invoice.paid
//                               invoice.payment_failed      → invoice.payment_failed
//                               customer.subscription.trial_will_end → subscription.trial_ending
//                               customer.subscription.deleted        → subscription.canceled
//
// Los precios de cada plan se crean en Stripe y sus ids se guardan en
// subscription_plans (provider_price_monthly_id / provider_price_annual_id).
import { type BillingProvider, type BillingWebhookEvent, ProviderNotConfiguredError } from "./types";

export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe" as const;
  readonly live = true;

  constructor(private readonly config: { secretKey?: string; webhookSecret?: string } = {}) {}

  private notEnabled(): never {
    throw new ProviderNotConfiguredError(
      "La integración con Stripe todavía no está habilitada. " +
        (this.config.secretKey ? "" : "Falta STRIPE_SECRET_KEY (servidor). ") +
        (this.config.webhookSecret ? "" : "Falta STRIPE_WEBHOOK_SECRET. ") +
        "Usa WATTALIS_BILLING_PROVIDER=mock para la demostración.",
    );
  }

  async createCustomer(): Promise<{ customerId: string }> {
    return this.notEnabled();
  }
  async createCheckoutSession(): Promise<{ sessionId: string; url: string; expiresAt: string }> {
    return this.notEnabled();
  }
  async createSubscription(): Promise<{ providerSubscriptionId: string }> {
    return this.notEnabled();
  }
  async getSubscription(): Promise<{ id: string; status: string } | null> {
    return this.notEnabled();
  }
  async changePlan(): Promise<void> {
    return this.notEnabled();
  }
  async cancelSubscription(): Promise<void> {
    return this.notEnabled();
  }
  async reactivateSubscription(): Promise<{ providerSubscriptionId: string }> {
    return this.notEnabled();
  }
  async getInvoices(): Promise<never[]> {
    return this.notEnabled();
  }
  async getCustomerPortalUrl(): Promise<string> {
    return this.notEnabled();
  }
  async handleWebhook(): Promise<BillingWebhookEvent> {
    return this.notEnabled();
  }
}
