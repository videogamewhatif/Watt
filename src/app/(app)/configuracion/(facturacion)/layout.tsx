import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/layout";
import { BillingTabs } from "@/features/billing/components/billing-tabs";
import { SubscriptionStatusBadge } from "@/features/billing/components/subscription-status-badge";
import { getWorkspaceEntitlements, isBillingActive } from "@/features/billing/server";
import { getAppContext } from "@/lib/session";

/**
 * Configuración → Suscripción y facturación. Solo Administración del espacio
 * (y en el futuro un rol de responsable de facturación). El resto de los roles
 * ve el plan y su estado, sin importes ni cobros.
 */
export default async function BillingSettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  const header = (
    <>
      <Link href="/configuracion" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        Configuración
      </Link>
      <PageHeader title="Suscripción y facturación" description={`Espacio activo: ${ctx.workspace.name}`} />
    </>
  );
  if (!(await isBillingActive())) {
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        <Alert tone="info" title="Facturación en línea no habilitada">
          Este entorno no tiene una pasarela de pagos configurada para esta cuenta. Los espacios funcionan sin restricciones comerciales. Para recorrer la demostración entra con «Pruebas».
        </Alert>
      </div>
    );
  }
  if (!ctx.can.manageBilling) {
    const ent = await getWorkspaceEntitlements();
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Plan del espacio</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
            {ent.plan?.name ?? "Sin plan"}
            {ent.status !== "unmanaged" ? <SubscriptionStatusBadge status={ent.status} /> : null}
          </p>
          <p className="mt-3 text-sm text-ink-soft">La suscripción, los cobros y los métodos de pago los gestiona la Administración del espacio.</p>
        </section>
      </div>
    );
  }
  return (
    <div className="animate-step-in mx-auto max-w-5xl">
      {header}
      <BillingTabs />
      {children}
    </div>
  );
}
