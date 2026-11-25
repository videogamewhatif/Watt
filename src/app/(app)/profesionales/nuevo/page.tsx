import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/layout";
import { SubscriptionFeatureGate } from "@/features/billing/components/subscription-feature-gate";
import { countUsage, getWorkspaceEntitlements } from "@/features/billing/server";
import { ProfessionalForm } from "@/features/professionals/components";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Nuevo profesional" };

export default async function NewProfessionalPage() {
  const ctx = await getAppContext();
  if (!ctx.can.manageCatalog) redirect("/profesionales");
  const [{ data: types }, entitlements, usage] = await Promise.all([
    ctx.supabase.from("professional_types").select("*").eq("active", true).order("sort_order"),
    getWorkspaceEntitlements(),
    countUsage(ctx),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/profesionales" className="text-sm font-medium text-brand-700 hover:underline">
        ← Profesionales
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Nuevo profesional</h1>
      <p className="text-sm text-muted">Después podrás asignarle servicios, definir su horario e invitarlo a Wattalis si lo necesita.</p>
      {/* La misma regla se verifica en el servidor al guardar (saveProfessional). */}
      <SubscriptionFeatureGate entitlements={entitlements} limit={{ code: "professionals.max", usage: usage.professionals }} canManageBilling={ctx.can.manageBilling} title="Límite de profesionales del plan">
        <Card className="p-5 sm:p-6">
          <ProfessionalForm organizationId={ctx.workspace.id} types={types ?? []} />
        </Card>
      </SubscriptionFeatureGate>
    </div>
  );
}
