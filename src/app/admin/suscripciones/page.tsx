import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/layout";
import { BillingAdminDashboard } from "@/features/billing/components/billing-admin-dashboard";
import { billingMode, getBillingActor, getBillingService, isBillingActive } from "@/features/billing/server";

export const metadata: Metadata = { title: "Suscripciones" };

export default async function PlatformSubscriptionsPage() {
  const actor = await getBillingActor();
  if (!actor?.platformRole) notFound();
  if (!(await isBillingActive())) {
    return (
      <>
        <PageHeader title="Suscripciones" />
        <Alert tone="info" title="Facturación no configurada">
          {billingMode() === "stripe"
            ? "WATTALIS_BILLING_PROVIDER=stripe está definido, pero la integración con Stripe aún no está implementada."
            : "Este entorno no tiene pasarela de pagos. La demostración se activa con el modo de prueba (desarrollo o WATTALIS_DEMO=1) o con WATTALIS_BILLING_PROVIDER=mock."}
        </Alert>
      </>
    );
  }
  // El servicio vuelve a exigir el rol de plataforma.
  const data = await getBillingService().adminDashboard(actor);
  return (
    <>
      <PageHeader title="Suscripciones" description="Clientes, ingresos recurrentes, planes y eventos de facturación de Wattalis." />
      <BillingAdminDashboard data={data} />
    </>
  );
}
