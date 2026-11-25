import type { NextRequest } from "next/server";
import { billingErrorOf } from "@/features/billing/providers/types";
import { billingEnabled, getBillingService } from "@/features/billing/server";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Notificaciones de la pasarela. Sin sesión: se autentican con su firma.
 * - Firma inválida → 400 (no se procesa nada).
 * - Evento repetido → 200 con duplicate: true (idempotente).
 * - Error inesperado → 500 para que la pasarela reintente.
 * En AWS este endpoint puede vivir en API Gateway + Lambda y encolar en SQS.
 */
export async function POST(request: NextRequest) {
  if (!billingEnabled()) return json({ error: "billing_disabled" }, 503);
  const rawBody = await request.text();
  const signature = request.headers.get("x-wattalis-signature") ?? request.headers.get("stripe-signature");
  try {
    const result = await getBillingService().processWebhook(rawBody, signature);
    return json({ received: true, duplicate: result.duplicate, id: result.eventId });
  } catch (error) {
    const known = billingErrorOf(error);
    if (known?.code === "invalid_signature") return json({ error: "invalid_signature" }, 400);
    if (known) return json({ error: known.code }, 422);
    console.error("[wattalis] webhook:", error instanceof Error ? error.message : "error");
    return json({ error: "processing_failed" }, 500);
  }
}
