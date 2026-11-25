import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { agendaHref } from "@/features/agenda/params";
import { ScheduleEditor, TimeOffManager } from "@/features/professionals/components";
import { loadSchedule } from "@/features/professionals/queries";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Mi horario" };

/**
 * El profesional con cuenta administra aquí su propio calendario: qué días y en
 * qué horas atiende, y sus vacaciones, comidas o ausencias. Recepción solo
 * puede agendarle dentro de ese horario y fuera de sus bloqueos.
 */
export default async function MySchedulePage() {
  const ctx = await getAppContext();
  const professionalId = ctx.ownProfessionalId;

  if (!professionalId) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Mi horario" />
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<CalendarClock className="size-6" aria-hidden />} title="Tu cuenta no tiene perfil profesional">
            Pide a la administración que vincule tu cuenta con tu perfil en Profesionales para configurar tu horario.
          </EmptyState>
        </div>
      </div>
    );
  }

  const { today, rules, blockItems } = await loadSchedule(ctx, professionalId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Mi horario"
        description="Tus días y horas de consulta, vacaciones y ausencias. Solo se te podrán agendar citas dentro de este horario."
        actions={
          <Link href={agendaHref({ date: today, view: "semana", professionalId })} className="text-sm font-medium text-brand-700 hover:underline">
            Ver mi agenda →
          </Link>
        }
      />

      <Card>
        <CardHeader title="Días y horas de trabajo" description="Si cambias tu horario, las citas que ya tienes se conservan; te avisaremos si alguna queda fuera." />
        <div className="p-5">
          <ScheduleEditor organizationId={ctx.workspace.id} professionalId={professionalId} rules={rules} readOnly={false} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Vacaciones y ausencias" description="Bloquea días completos o ratos (comida, juntas). Nadie podrá agendarte en esos periodos." />
        <div className="p-5">
          <TimeOffManager organizationId={ctx.workspace.id} professionalId={professionalId} items={blockItems} today={today} readOnly={false} />
        </div>
      </Card>
    </div>
  );
}
