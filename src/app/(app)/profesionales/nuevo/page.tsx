import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/layout";
import { ProfessionalForm } from "@/features/professionals/components";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Nuevo profesional" };

export default async function NewProfessionalPage() {
  const ctx = await getAppContext();
  if (!ctx.can.manageCatalog) redirect("/profesionales");
  const { data: types } = await ctx.supabase.from("professional_types").select("*").eq("active", true).order("sort_order");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/profesionales" className="text-sm font-medium text-brand-700 hover:underline">
        ← Profesionales
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Nuevo profesional</h1>
      <p className="text-sm text-muted">Después podrás asignarle servicios, definir su horario e invitarlo a Wattalis si lo necesita.</p>
      <Card className="p-5 sm:p-6">
        <ProfessionalForm organizationId={ctx.workspace.id} types={types ?? []} />
      </Card>
    </div>
  );
}
