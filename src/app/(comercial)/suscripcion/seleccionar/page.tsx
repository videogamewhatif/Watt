import type { Metadata } from "next";
import { PlanPicker } from "@/features/billing/components/plan-picker";
import { SubscriptionCheckoutStepper } from "@/features/billing/components/subscription-checkout-stepper";
import { intervalFromParam } from "@/features/billing/presenter";
import { loadPublicCatalog } from "@/features/billing/queries";
import { getAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "Elige tu plan" };

export default async function SelectPlanPage({ searchParams }: PageProps<"/suscripcion/seleccionar">) {
  const params = await searchParams;
  const [{ offers, settings }, { user }] = await Promise.all([loadPublicCatalog(), getAuthUser()]);
  return (
    <div className="animate-step-in">
      <SubscriptionCheckoutStepper current={1} />
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Elige tu plan</h1>
        <p className="mt-2 text-sm text-muted">Puedes cambiarlo después. Verás el resumen completo antes de confirmar.</p>
      </header>
      <PlanPicker
        offers={offers}
        initialPlan={typeof params.plan === "string" ? params.plan : null}
        initialInterval={intervalFromParam(params.periodo)}
        discountBps={settings.annual_discount_bps}
        nextPath={user ? "/suscripcion/organizacion" : "/suscripcion/registro"}
      />
    </div>
  );
}
