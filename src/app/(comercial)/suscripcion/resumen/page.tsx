import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { CheckoutSummary } from "@/features/billing/components/checkout-summary";
import { ConfirmOrderForm } from "@/features/billing/components/confirm-order-form";
import { SubscriptionCheckoutStepper } from "@/features/billing/components/subscription-checkout-stepper";
import { addInterval, formatCents, quote } from "@/features/billing/pricing";
import { planHighlights } from "@/features/billing/presenter";
import { resolveCheckoutPlan } from "@/features/billing/queries";
import { getBillingActor, getBillingService } from "@/features/billing/server";
import { getAuthUser, getWorkspaces } from "@/lib/session";

export const metadata: Metadata = { title: "Resumen del pedido" };

export default async function CheckoutSummaryPage({ searchParams }: PageProps<"/suscripcion/resumen">) {
  const params = await searchParams;
  const { plan, interval, settings, query, entitlements, active: enabled } = await resolveCheckoutPlan(params);
  if (!plan) redirect("/suscripcion/seleccionar");
  const { user } = await getAuthUser();
  if (!user) redirect(`/suscripcion/registro?${query}`);
  const workspaceId = typeof params.espacio === "string" ? params.espacio : "";
  const { workspaces } = await getWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId && w.role === "admin");
  const actor = await getBillingActor();
  if (!enabled || !workspace || !actor) redirect(`/suscripcion/organizacion?${query}`);

  const service = getBillingService();
  const [eligibility, overview] = await Promise.all([service.checkoutEligibility(actor, workspace.id), service.getOverview(actor, workspace.id)]);
  if (!overview.account || overview.account.organization_id !== workspace.id) redirect(`/suscripcion/organizacion?${query}`);
  const q = quote(plan, interval, settings)!;
  const { items } = planHighlights(plan, entitlements, null);
  const renewal = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: overview.account.timezone }).format(new Date(addInterval(new Date().toISOString(), interval)));

  return (
    <div className="animate-step-in">
      <SubscriptionCheckoutStepper current={4} />
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Revisa tu pedido</h1>
        <p className="mt-2 text-sm text-muted">Confirma los datos antes de pasar al pago.</p>
      </header>
      {params.cancelado === "1" ? (
        <div className="mb-6">
          <Alert tone="info" title="Cancelaste el proceso de pago">
            No se realizó ningún cargo. Puedes revisar tu pedido y volver a intentarlo cuando quieras.
          </Alert>
        </div>
      ) : null}
      {!eligibility.ok ? (
        <Alert
          tone="warning"
          title="Este espacio ya tiene una suscripción"
          action={
            <Link href="/configuracion/suscripcion" className="font-semibold underline">
              Ir a Suscripción y facturación
            </Link>
          }
        >
          {eligibility.reason}
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <CheckoutSummary
            plan={plan}
            interval={interval}
            quote={q}
            organizationName={overview.account.legal_name}
            features={items.slice(0, 8)}
            renewalLabel={renewal}
            discountBps={settings.annual_discount_bps}
          />
          <div className="space-y-4">
            {eligibility.mode === "trial" ? (
              <Alert tone="info">Tu periodo de prueba termina al confirmar el pago; el nuevo periodo empieza hoy.</Alert>
            ) : eligibility.mode === "reactivate" ? (
              <Alert tone="info">Reactivarás la suscripción de este espacio. Tu información se conservó completa.</Alert>
            ) : null}
            <ConfirmOrderForm workspaceId={workspace.id} planCode={plan.code} interval={interval} totalLabel={`${formatCents(q.tax.totalCents)} MXN`} />
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <Link href={`/suscripcion/seleccionar?${query}`} className="font-medium text-brand-700 hover:underline">
                Cambiar plan
              </Link>
              <Link href={`/suscripcion/organizacion?${query}`} className="font-medium text-brand-700 hover:underline">
                Cambiar organización o datos
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
