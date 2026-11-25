import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/layout";
import { agendaHref } from "@/features/agenda/params";
import { AccountLink, ActiveToggle, ProfessionalForm, ScheduleEditor, ServicesPicker, TimeOffManager } from "@/features/professionals/components";
import { loadSchedule } from "@/features/professionals/queries";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Profesional" };

export default async function ProfessionalPage({ params }: PageProps<"/profesionales/[id]">) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: professional } = await ctx.supabase.from("professionals").select("*").eq("id", id).eq("organization_id", ctx.workspace.id).maybeSingle();
  // RLS: si es de otro espacio o de otro profesional, simplemente no existe para esta cuenta.
  if (!professional) notFound();

  const manage = ctx.can.manageCatalog;
  // El propio profesional también edita su horario y bloqueos (RLS lo permite).
  const editSchedule = manage || professional.id === ctx.ownProfessionalId;
  const [{ data: types }, { data: services }, { data: links }, { today, rules, blockItems }, members] = await Promise.all([
    ctx.supabase.from("professional_types").select("*").order("sort_order"),
    ctx.supabase.from("services").select("id, name, duration_minutes, active").eq("organization_id", ctx.workspace.id).order("name"),
    ctx.supabase.from("professional_services").select("service_id").eq("professional_id", id),
    loadSchedule(ctx, id),
    manage
      ? Promise.all([
          ctx.supabase.from("memberships").select("user_id").eq("organization_id", ctx.workspace.id),
          ctx.supabase.from("professionals").select("user_id").eq("organization_id", ctx.workspace.id).not("user_id", "is", null),
          ctx.supabase.from("profiles").select("id, full_name, email"),
        ])
      : null,
  ]);

  let linked: { id: string; name: string; email: string | null } | null = null;
  let candidates: { id: string; name: string; email: string | null }[] = [];
  if (members) {
    const [{ data: ms }, { data: taken }, { data: profiles }] = members;
    const takenIds = new Set((taken ?? []).map((t) => t.user_id));
    const profile = (uid: string) => profiles?.find((p) => p.id === uid);
    candidates = (ms ?? [])
      .filter((m) => !takenIds.has(m.user_id))
      .map((m) => ({ id: m.user_id, name: profile(m.user_id)?.full_name || "Sin nombre", email: profile(m.user_id)?.email ?? null }));
    if (professional.user_id) {
      const p = profile(professional.user_id);
      linked = { id: professional.user_id, name: p?.full_name || "Cuenta vinculada", email: p?.email ?? null };
    }
  }

  const typeLabel = types?.find((t) => t.code === professional.professional_type)?.label ?? professional.professional_type;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link href={ctx.can.viewCatalog ? "/profesionales" : "/inicio"} className="text-sm font-medium text-brand-700 hover:underline">
          ← {ctx.can.viewCatalog ? "Profesionales" : "Inicio"}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-4 rounded-full" style={{ background: professional.color }} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{professional.display_name}</h1>
              <p className="text-sm text-muted">
                {typeLabel}
                {professional.specialty ? ` · ${professional.specialty}` : ""}
                {professional.active ? "" : " · Inactivo"}
              </p>
            </div>
          </div>
          <Link href={agendaHref({ date: today, view: "semana", professionalId: id })} className="text-sm font-medium text-brand-700 hover:underline">
            Ver su agenda →
          </Link>
        </div>
      </div>

      {manage ? (
        <Card>
          <CardHeader title="Datos" />
          <div className="p-5">
            <ProfessionalForm organizationId={ctx.workspace.id} types={(types ?? []).filter((t) => t.active)} professional={professional} />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Servicios" description="Solo se podrá agendar con los servicios asignados." />
        <div className="p-5">
          <ServicesPicker organizationId={ctx.workspace.id} professionalId={id} services={services ?? []} selected={(links ?? []).map((l) => l.service_id)} readOnly={!manage} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Horario semanal" />
        <div className="p-5">
          <ScheduleEditor organizationId={ctx.workspace.id} professionalId={id} rules={rules} readOnly={!editSchedule} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Bloqueos" description="Vacaciones, comida o ausencias puntuales." />
        <div className="p-5">
          <TimeOffManager organizationId={ctx.workspace.id} professionalId={id} items={blockItems} today={today} readOnly={!editSchedule} />
        </div>
      </Card>

      {manage ? (
        <>
          <Card>
            <CardHeader title="Cuenta de acceso" description="Con una cuenta vinculada, el profesional consulta su propia agenda." />
            <div className="p-5">
              <AccountLink organizationId={ctx.workspace.id} professionalId={id} linked={linked} candidates={candidates} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Estado" description="Desactivar conserva el historial e impide nuevas reservas. Nunca cancela citas." />
            <div className="p-5">
              <ActiveToggle organizationId={ctx.workspace.id} professionalId={id} active={professional.active} name={professional.display_name} />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
