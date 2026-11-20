import { ArrowRight, CalendarPlus, CheckCircle2, Circle, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { agendaHref } from "@/features/agenda/params";
import { loadDashboard } from "@/features/dashboard/queries";
import { getAppContext } from "@/lib/session";
import { formatLongDate, formatMediumDate, splitLocal } from "@/lib/tz";

export const metadata: Metadata = { title: "Inicio" };

function Stat({ label, value, href, hint }: { label: string; value: number; href: string; hint?: string }) {
  return (
    <Link href={href} className="group rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-700">
        {hint ?? "Ver en la agenda"} <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </p>
    </Link>
  );
}

export default async function HomePage() {
  const ctx = await getAppContext();
  const summary = await loadDashboard(ctx);

  if (!summary) {
    return (
      <Alert tone="error" title="No pudimos cargar el resumen" action={<Link href="/inicio" className="font-semibold underline">Reintentar</Link>}>
        Revisa tu conexión e inténtalo de nuevo.
      </Alert>
    );
  }

  const today = summary.today;
  const todayList = agendaHref({ date: today, view: "lista" });
  const next = summary.next_appointment;
  const steps = [
    { done: summary.setup.has_professional, label: "Registra al primer profesional", href: "/profesionales/nuevo" },
    { done: summary.setup.has_service, label: "Crea un servicio con su duración", href: "/servicios" },
    {
      done: summary.setup.has_assignment && summary.setup.has_schedule,
      label: "Asigna servicios y configura la disponibilidad semanal",
      href: "/profesionales",
    },
    { done: summary.setup.has_appointment, label: "Agenda la primera cita", href: agendaHref({ date: today, openNew: true }) },
  ];
  const pendingSteps = steps.filter((s) => !s.done);
  const isProfessionalOnly = !ctx.can.allAppointments;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{ctx.workspace.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{formatLongDate(today)}</h1>
          {isProfessionalOnly ? <p className="mt-1 text-sm text-muted">Tu actividad como profesional.</p> : null}
        </div>
        <LinkButton href={agendaHref({ date: today, openNew: true })} icon={<CalendarPlus className="size-4" aria-hidden />}>
          Nueva cita
        </LinkButton>
      </div>

      {ctx.can.manageCatalog && pendingSteps.length > 0 ? (
        <Card>
          <CardHeader title="Cómo empezar" description="Completa estos pasos para recibir citas. Los pasos terminados se ocultan." />
          <ol className="divide-y divide-line">
            {steps.map((s, i) =>
              s.done ? null : (
                <li key={s.label}>
                  <Link href={s.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-sunken">
                    <Circle className="size-5 shrink-0 text-brand-400" aria-hidden />
                    <span className="flex-1">
                      <span className="text-muted">Paso {i + 1}.</span> <span className="font-medium">{s.label}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ),
            )}
          </ol>
          {steps.some((s) => s.done) ? (
            <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
              {steps.filter((s) => s.done).length} de {steps.length} pasos completados
            </p>
          ) : null}
        </Card>
      ) : null}

      <section aria-label="Resumen de hoy" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Citas de hoy" value={summary.today_total} href={todayList} hint="Ver la lista del día" />
        <Stat label="Pendientes hoy" value={summary.today_pending} href={agendaHref({ date: today, view: "lista", status: "pending" })} />
        <Stat label="Confirmadas hoy" value={summary.today_confirmed} href={agendaHref({ date: today, view: "lista", status: "confirmed" })} />
        <Stat label="Atendidas hoy" value={summary.today_attended} href={agendaHref({ date: today, view: "lista", status: "attended" })} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Próxima cita" />
          {next ? (
            <Link href={agendaHref({ date: splitLocal(next.local_start).date, appointmentId: next.id })} className="block px-5 py-4 hover:bg-sunken">
              <p className="tabular flex items-center gap-2 text-lg font-semibold">
                <Clock className="size-5 text-brand-700" aria-hidden />
                {splitLocal(next.local_start).time}
                <span className="text-sm font-normal text-muted">
                  {splitLocal(next.local_start).date === today ? "hoy" : formatMediumDate(splitLocal(next.local_start).date)}
                </span>
              </p>
              <p className="mt-1 font-medium">{next.contact_name}</p>
              <p className="text-sm text-muted">
                {next.service_name} · {next.professional_name}
              </p>
              <div className="mt-2">
                <StatusBadge status={next.status} />
              </div>
            </Link>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">No hay citas próximas pendientes o confirmadas.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Por confirmar" description="Citas futuras que siguen pendientes." />
          <div className="px-5 py-4">
            <p className="tabular text-3xl font-semibold">{summary.upcoming_pending}</p>
            <Link href={agendaHref({ date: today, view: "lista", status: "pending" })} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Revisar las de hoy <ArrowRight className="size-3" aria-hidden />
            </Link>
            {summary.today_no_show + summary.today_cancelled > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Hoy: {summary.today_cancelled} cancelada(s) y {summary.today_no_show} sin asistencia.
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
