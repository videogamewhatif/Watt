import type { Metadata } from "next";
import { PaymentMethodsPanel } from "@/features/billing/components/payment-methods-panel";
import { TEST_CARDS } from "@/features/billing/test-cards";
import { loadWorkspaceBilling } from "@/features/billing/workspace";

export const metadata: Metadata = { title: "Métodos de pago" };

export default async function PaymentMethodsPage() {
  const data = await loadWorkspaceBilling();
  if (!data) return null;
  const { ctx, overview } = data;
  if (!overview.account || overview.centrallyBilled) {
    return <p className="rounded-2xl border border-dashed border-line-strong p-6 text-sm text-muted">{overview.centrallyBilled ? "Los métodos de pago los gestiona la cuenta corporativa." : "Este espacio aún no tiene una cuenta de facturación. Se crea al contratar un plan."}</p>;
  }
  const active = Boolean(overview.subscription && !["canceled", "expired"].includes(overview.subscription.status));
  return <PaymentMethodsPanel organizationId={ctx.workspace.id} methods={overview.paymentMethods} cards={TEST_CARDS} hasActiveSubscription={active} />;
}
