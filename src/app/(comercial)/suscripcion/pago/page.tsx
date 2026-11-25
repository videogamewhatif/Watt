import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { DemoPaymentForm } from "@/features/billing/components/demo-payment-form";
import { SubscriptionCheckoutStepper } from "@/features/billing/components/subscription-checkout-stepper";
import { formatCents, INTERVAL_LABEL } from "@/features/billing/pricing";
import { PERIOD_PARAM } from "@/features/billing/presenter";
import { getBillingActor, getBillingService, isBillingActive } from "@/features/billing/server";

export const metadata: Metadata = { title: "Pago" };

export default async function CheckoutPaymentPage({ searchParams }: PageProps<"/suscripcion/pago">) {
  const sessionId = (await searchParams).sesion;
  const actor = await getBillingActor();
  if (!actor) redirect("/iniciar-sesion");
  if (!(await isBillingActive()) || typeof sessionId !== "string") notFound();
  const found = await getBillingService().getCheckout(actor, sessionId);
  if (!found) notFound();
  const { session, plan, account, invoice } = found;
  if (session.status === "completed" || session.status === "pending") redirect(`/suscripcion/confirmacion?sesion=${session.id}`);
  if (session.status === "canceled" || session.status === "expired") redirect(`/suscripcion/resumen?plan=${plan.code}&periodo=${PERIOD_PARAM[session.billing_interval]}&espacio=${account.organization_id}&cancelado=1`);
  const total = `${formatCents(session.amount_cents)} MXN`;

  return (
    <div className="animate-step-in">
      <SubscriptionCheckoutStepper current={5} />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section aria-labelledby="pago-titulo" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <ShieldCheck className="size-4 text-brand-700" aria-hidden />
            Pasarela de pago simulada
          </p>
          <h1 id="pago-titulo" className="mt-2 mb-5 text-2xl font-semibold tracking-tight text-ink">
            Método de pago
          </h1>
          {session.status === "failed" ? (
            <div className="mb-5">
              <Alert tone="error" title="El pago anterior fue rechazado (simulado)">
                {session.failure_reason ?? "La pasarela rechazó el cobro."} Puedes intentarlo de nuevo.
              </Alert>
            </div>
          ) : null}
          <DemoPaymentForm sessionId={session.id} totalLabel={total} />
        </section>
        <aside aria-labelledby="pedido-titulo" className="h-fit rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="pedido-titulo" className="text-base font-semibold text-ink">
            Tu pedido
          </h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Organización</dt>
              <dd className="text-right font-medium text-ink">{account.legal_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Plan</dt>
              <dd className="font-medium text-ink">{plan.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Periodicidad</dt>
              <dd className="font-medium text-ink">{INTERVAL_LABEL[session.billing_interval]}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">IVA</dt>
              <dd className="tabular text-ink">{formatCents(invoice.tax_cents)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-line pt-3">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="tabular text-lg font-semibold text-ink">{total}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">Referencia del pedido: {invoice.invoice_reference}</p>
        </aside>
      </div>
    </div>
  );
}
