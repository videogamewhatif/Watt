// Pasarela SIMULADA para la demostración. No se conecta a ningún servicio, no
// recibe datos de tarjeta y no mueve dinero. Firma sus eventos con HMAC igual que
// lo haría una pasarela real, para ejercitar la verificación y la idempotencia.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { type BillingProvider, type BillingWebhookEvent, WebhookSignatureError } from "./types";

/** Secreto solo para la demostración. En producción la pasarela real usa su propio secreto (Secrets Manager). */
const DEFAULT_DEMO_SECRET = "wattalis-demo-webhook-secret-no-productivo";

export interface SimulatableProvider extends BillingProvider {
  /** Construye un evento firmado como si llegara de la pasarela. */
  signEvent(event: Omit<BillingWebhookEvent, "id" | "created"> & { id?: string }): { rawBody: string; signature: string };
}

export function isSimulatable(provider: BillingProvider): provider is SimulatableProvider {
  return typeof (provider as Partial<SimulatableProvider>).signEvent === "function";
}

const short = () => randomUUID().replaceAll("-", "").slice(0, 16);

export class MockBillingProvider implements SimulatableProvider {
  readonly name = "mock" as const;
  readonly live = false;
  private readonly secret: string;

  constructor(options: { secret?: string; appUrl?: string } = {}) {
    this.secret = options.secret || DEFAULT_DEMO_SECRET;
  }

  private sign(body: string): string {
    return `v1=${createHmac("sha256", this.secret).update(body).digest("hex")}`;
  }

  signEvent(event: Omit<BillingWebhookEvent, "id" | "created"> & { id?: string }) {
    const full: BillingWebhookEvent = { id: event.id ?? `evt_demo_${short()}`, created: new Date().toISOString(), type: event.type, data: event.data };
    const rawBody = JSON.stringify(full);
    return { rawBody, signature: this.sign(rawBody) };
  }

  async createCustomer() {
    return { customerId: `cus_demo_${short()}` };
  }

  async createCheckoutSession() {
    const sessionId = `cs_demo_${short()}`;
    // La "página alojada" de la pasarela simulada vive en la propia app.
    return { sessionId, url: `/suscripcion/pago?sesion=${sessionId}`, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString() };
  }

  async createSubscription() {
    return { providerSubscriptionId: `sub_demo_${short()}` };
  }

  async getSubscription(providerSubscriptionId: string) {
    return { id: providerSubscriptionId, status: "simulated" };
  }

  async changePlan() {}

  async cancelSubscription() {}

  async reactivateSubscription(input: { providerSubscriptionId: string }) {
    return { providerSubscriptionId: input.providerSubscriptionId };
  }

  async getInvoices() {
    // El historial de la demostración vive en el repositorio (es el que la pasarela reportaría).
    return [];
  }

  async getCustomerPortalUrl(input: { returnUrl: string }) {
    // Sin portal real: la gestión simulada de métodos de pago está en la app.
    return `/configuracion/suscripcion/metodos-de-pago?volver=${encodeURIComponent(input.returnUrl)}`;
  }

  async handleWebhook(rawBody: string, signature: string | null): Promise<BillingWebhookEvent> {
    if (!signature) throw new WebhookSignatureError();
    const expected = Buffer.from(this.sign(rawBody));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new WebhookSignatureError();
    const event = JSON.parse(rawBody) as BillingWebhookEvent;
    if (!event?.id || !event.type) throw new WebhookSignatureError();
    return event;
  }
}
