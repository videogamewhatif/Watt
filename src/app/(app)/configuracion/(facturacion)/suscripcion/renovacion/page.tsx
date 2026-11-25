import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/layout";
import { RenewalToggle } from "@/features/billing/components/renewal-toggle";
import { NOTIFICATION_TEMPLATES, type TemplateKey } from "@/features/billing/notifications";
import { formatCents, INTERVAL_UNIT, taxBreakdown } from "@/features/billing/pricing";
import { EVENT_LABEL } from "@/features/billing/state-machine";
import { formatDate, formatDateTime, loadWorkspaceBilling } from "@/features/billing/workspace";

export const metadata: Metadata = { title: "Renovación" };

const RENEWAL_EVENTS = new Set(["checkout_completed", "renewed", "payment_failed", "payment_retry_failed", "payment_recovered", "trial_converted", "trial_payment_failed", "grace_period_expired", "period_ended_canceled", "reactivated", "plan_changed", "cancel_scheduled", "cancel_undone"]);
const PAYMENT_TEMPLATES = new Set<string>(["renewal_upcoming", "payment_succeeded", "payment_failed", "payment_reminder", "trial_ending"]);

export default async function RenewalPage() {
  const data = await loadWorkspaceBilling();
  if (!data) return null;
  const { ctx, actor, service, overview } = data;
  const sub = overview.subscription;
  const tz = overview.account?.timezone ?? ctx.workspace.timezone;
  const [history, notifications] = await Promise.all([service.listHistory(actor, ctx.workspace.id), service.listNotifications(actor, ctx.workspace.id)]);
  const renewals = history.filter((e) => RENEWAL_EVENTS.has(e.event_type));
  const notices = notifications.filter((n) => PAYMENT_TEMPLATES.has(n.template)).slice(0, 5);
  const live = sub && !["canceled", "expired", "incomplete", "unpaid"].includes(sub.status);
  const nextCharge = sub && live && !sub.cancel_at_period_end ? (sub.status === "trialing" ? sub.trial_ends_at : sub.current_period_end) : null;
  const amount = overview.periodPriceCents !== null ? taxBreakdown(overview.periodPriceCents, overview.settings).totalCents : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Renovación automática" description="Al final de cada periodo se cobra el plan con tu método de pago predeterminado." />
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <RenewalToggle
              organizationId={ctx.workspace.id}
              enabled={Boolean(live && !sub?.cancel_at_period_end)}
              canChange={Boolean(live) && !overview.centrallyBilled}
              planName={overview.plan?.name ?? ""}
              accessUntilLabel={sub?.current_period_end ? formatDate(sub.current_period_end, tz) : null}
            />
            {!live ? <p className="text-sm text-muted">La renovación no aplica en el estado actual de la suscripción.</p> : null}
          </div>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted">Fecha del siguiente cobro</dt>
              <dd className="mt-0.5 font-medium text-ink">{nextCharge ? formatDate(nextCharge, tz) : sub?.cancel_at_period_end ? "No habrá más cobros" : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Importe</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {nextCharge && amount !== null && sub ? `${formatCents(amount)} MXN por ${INTERVAL_UNIT[sub.billing_interval]} (simulado)` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Periodo de gracia si un pago falla</dt>
              <dd className="mt-0.5 font-medium text-ink">{overview.settings.grace_period_days} días</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader title="Política de cancelación" />
        <ul className="list-disc space-y-1.5 p-5 pl-10 text-sm text-ink-soft">
          <li>Puedes cancelar la renovación en cualquier momento; conservas el acceso hasta el final del periodo pagado.</li>
          <li>No hay cargos por cancelar ni reembolsos parciales del periodo en curso.</li>
          <li>Puedes deshacer la cancelación antes del vencimiento, o reactivar un plan después.</li>
          <li>Tu información médica y administrativa nunca se elimina por cancelar: queda en modo de consulta y exportación.</li>
          <li>Si un pago falla te avisamos, reintentamos el cobro y mantienes el acceso durante el periodo de gracia.</li>
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Avisos de pago"
          description="Recordatorios de renovación y resultados de cobro."
          actions={
            <Link href="/configuracion/suscripcion/avisos" className="text-sm font-medium text-brand-700 hover:underline">
              Ver todos
            </Link>
          }
        />
        {notices.length ? (
          <ul className="divide-y divide-line">
            {notices.map((n) => (
              <li key={n.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium text-ink">{NOTIFICATION_TEMPLATES[n.template as TemplateKey] ?? n.subject}</span>
                <span className="text-muted">{formatDateTime(n.created_at, tz)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">Sin avisos de pago por ahora.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Historial de renovaciones y cambios" />
        {renewals.length ? (
          <ol className="divide-y divide-line">
            {renewals.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium text-ink">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                  <span className="ml-2 text-xs text-muted">{e.source === "provider" ? "Pasarela (simulada)" : e.source === "user" ? "Administración del espacio" : e.source === "platform_admin" ? "Equipo Wattalis" : "Sistema"}</span>
                </span>
                <span className="text-muted">{formatDateTime(e.created_at, tz)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">Aún no hay renovaciones.</p>
        )}
      </Card>
    </div>
  );
}
