import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { OrganizationStepForm, type WorkspaceChoice } from "@/features/billing/components/organization-step-form";
import { SelectedPlanChip } from "@/features/billing/components/selected-plan-chip";
import { SubscriptionCheckoutStepper } from "@/features/billing/components/subscription-checkout-stepper";
import { resolveCheckoutPlan } from "@/features/billing/queries";
import { getBillingActor, getBillingService } from "@/features/billing/server";
import { STATUS_INFO } from "@/features/billing/state-machine";
import { ROLE_LABEL } from "@/lib/labels";
import { getAuthUser, getWorkspaces } from "@/lib/session";
import { MEXICO_TIMEZONES } from "@/lib/tz";

export const metadata: Metadata = { title: "Tu organización" };

const OTHER_TIMEZONES = [
  { value: "America/Bogota", label: "Bogotá / Lima (UTC−5)" },
  { value: "America/Santiago", label: "Santiago de Chile" },
  { value: "America/Guatemala", label: "Guatemala" },
  { value: "Europe/Madrid", label: "Madrid" },
];

export default async function CheckoutOrganizationPage({ searchParams }: PageProps<"/suscripcion/organizacion">) {
  const { plan, interval, settings, query, active: enabled } = await resolveCheckoutPlan(await searchParams);
  if (!plan) redirect("/suscripcion/seleccionar");
  const { user } = await getAuthUser();
  if (!user) redirect(`/suscripcion/registro?${query}`);
  const [{ workspaces }, actor] = await Promise.all([getWorkspaces(), getBillingActor()]);

  const choices: WorkspaceChoice[] = [];
  if (enabled && actor) {
    const service = getBillingService();
    for (const w of workspaces) {
      if (w.role !== "admin") {
        choices.push({ id: w.id, name: w.name, kind: w.kind, timezone: w.timezone, blockedReason: `Tu rol es ${ROLE_LABEL[w.role]}: solo Administración puede contratar.`, hint: "", prefill: { contactName: "", billingEmail: "", phone: "", country: "MX" } });
        continue;
      }
      const [eligibility, overview] = await Promise.all([service.checkoutEligibility(actor, w.id), service.getOverview(actor, w.id)]);
      const account = overview.account?.organization_id === w.id ? overview.account : null;
      const hint = eligibility.ok
        ? { new: "Sin plan contratado.", trial: "En periodo de prueba: se convertirá en suscripción.", reactivate: "Suscripción terminada: se reactivará.", retry: "Contratación pendiente de pago." }[eligibility.mode]
        : "";
      choices.push({
        id: w.id,
        name: w.name,
        kind: w.kind,
        timezone: w.timezone,
        blockedReason: eligibility.ok ? null : `Ya tiene una suscripción (${STATUS_INFO[eligibility.status].label.toLowerCase()}). Cámbiala desde Configuración.`,
        hint,
        prefill: {
          contactName: account?.contact_name ?? user.user_metadata?.full_name ?? "",
          billingEmail: account?.billing_email ?? user.email ?? "",
          phone: account?.phone ?? "",
          country: account?.country ?? "MX",
        },
      });
    }
  }

  return (
    <div className="animate-step-in">
      <SubscriptionCheckoutStepper current={3} />
      <SelectedPlanChip plan={plan} interval={interval} settings={settings} changeHref={`/suscripcion/seleccionar?${query}`} />
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Tu organización</h1>
        <p className="mt-2 text-sm text-muted">Elige el espacio de trabajo donde se contratará el plan o registra una organización nueva.</p>
      </header>
      {!enabled ? (
        <Alert tone="info" title="Contratación en línea no disponible">
          La facturación en línea aún no está habilitada para esta cuenta en este entorno. Para recorrer la demostración, entra con una cuenta de prueba desde el paso anterior.
        </Alert>
      ) : (
        <OrganizationStepForm
          workspaces={choices}
          planCode={plan.code}
          interval={interval}
          defaults={{ contactName: String(user.user_metadata?.full_name ?? ""), billingEmail: user.email ?? "" }}
          timezones={[...MEXICO_TIMEZONES, ...OTHER_TIMEZONES]}
        />
      )}
    </div>
  );
}
