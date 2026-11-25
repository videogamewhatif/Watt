import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/layout";
import { ReportChart } from "@/features/reports/components/charts";
import { FEATURES } from "../catalog";
import { NOTIFICATION_TEMPLATES, type TemplateKey } from "../notifications";
import { formatCents, INTERVAL_LABEL, pct } from "../pricing";
import type { BillingService } from "../service";
import { EVENT_LABEL } from "../state-machine";
import { AdminPlanEditor, AdminResetButton, AdminSettingsForm, AdminSimulationMenu } from "./admin-controls";
import { NotificationInbox } from "./notification-inbox";
import { SubscriptionStatusBadge } from "./subscription-status-badge";

type Dashboard = Awaited<ReturnType<BillingService["adminDashboard"]>>;

const TZ = "America/Mexico_City";
const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: TZ }).format(new Date(iso)) : "—");
const dateTime = (iso: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(new Date(iso));
const month = (key: string) => new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
const SOURCE: Record<string, string> = { provider: "Pasarela (simulada)", system: "Sistema", user: "Clínica", platform_admin: "Plataforma" };

function Kpi({ label, value, hint, strong = false }: { label: string; value: ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? "border-brand-300 bg-brand-50" : "border-line bg-surface"}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24 space-y-4">
      <div>
        <h2 id={`${id}-t`} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Panel global del equipo Wattalis: métricas, clientes, planes, eventos y simulaciones. */
export function BillingAdminDashboard({ data }: { data: Dashboard }) {
  const { metrics: m, customers, plans, entitlements, settings, events, audit, leads, notifications } = data;
  const accountName = new Map(customers.map((c) => [c.account.id, c.account.legal_name]));
  const subOrg = new Map(customers.flatMap((c) => (c.subscription ? [[c.subscription.id, c.account.legal_name] as const] : [])));
  const months = m.months;

  return (
    <div className="space-y-12">
      <div role="note" className="flex items-start gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
        <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">Ingresos simulados.</span> Todas las cifras provienen de la pasarela de demostración y de clientes ficticios. No representan ingresos reales ni pagos
          confirmados.
        </p>
      </div>

      <nav aria-label="Secciones del panel" className="-mx-1 flex gap-1 overflow-x-auto pb-1 text-sm">
        {[
          ["indicadores", "Indicadores"],
          ["metricas", "Métricas"],
          ["clientes", "Clientes"],
          ["planes", "Planes"],
          ["configuracion", "Configuración"],
          ["eventos", "Eventos"],
          ["auditoria", "Auditoría"],
          ["avisos", "Avisos"],
          ["demo", "Demostración"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-line bg-surface px-3 py-1.5 font-medium whitespace-nowrap text-ink-soft hover:border-brand-300 hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Section id="indicadores" title="Indicadores">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Organizaciones registradas" value={m.organizations} />
          <Kpi label="Suscripciones activas" value={m.active} />
          <Kpi label="En periodo de prueba" value={m.trialing} />
          <Kpi label="Vencidas" value={m.overdue} hint={`Pago vencido o en gracia · ${m.unpaid} en impago`} />
          <Kpi label="Cancelaciones (30 días)" value={m.canceledLast30} hint={`${m.scheduledCancellations} programadas · ${m.canceled} en total`} />
          <Kpi label="MRR simulado" value={formatCents(m.mrrCents, { compact: true })} hint="Ingreso recurrente mensual" strong />
          <Kpi label="ARR simulado" value={formatCents(m.arrCents, { compact: true })} hint="MRR × 12" strong />
          <Kpi label="Tasa de cancelación" value={pct(m.churnBps)} hint="Últimos 30 días" />
          <Kpi label="Pagos simulados pendientes" value={m.pendingPayments} hint={formatCents(m.pendingAmountCents)} />
          <Kpi label="Contrataciones incompletas" value={m.incomplete} />
        </div>
        <Card>
          <CardHeader title="Distribución por plan" description="Suscripciones vigentes y su MRR simulado." />
          <ul className="divide-y divide-line">
            {m.byPlan.map((p) => (
              <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium text-ink">{p.name}</span>
                <span className="text-ink-soft">
                  <span className="tabular font-semibold text-ink">{p.count}</span> suscripciones · {formatCents(p.mrrCents, { compact: true })}/mes
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section id="metricas" title="Métricas" description="Últimos 12 meses (simulado). Cada gráfica muestra el valor al pasar el cursor.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportChart chart={{ id: "crecimiento", kind: "columns", title: "Crecimiento de suscripciones", description: "Suscripciones con servicio al cierre de cada mes.", format: "int", points: months.map((p) => ({ label: month(p.month), value: p.active })) }} />
          <ReportChart chart={{ id: "mrr", kind: "columns", title: "MRR mensual (simulado)", format: "money", points: months.map((p) => ({ label: month(p.month), value: p.mrrCents / 100 })) }} />
          <ReportChart chart={{ id: "planes", kind: "bars", title: "Clientes por plan", format: "int", points: m.byPlan.map((p) => ({ label: p.name, value: p.count })) }} />
          <ReportChart chart={{ id: "altas", kind: "columns", title: "Nuevas altas", format: "int", points: months.map((p) => ({ label: month(p.month), value: p.newSubscriptions })) }} />
          <ReportChart chart={{ id: "cancelaciones", kind: "columns", title: "Cancelaciones", format: "int", points: months.map((p) => ({ label: month(p.month), value: p.cancellations })) }} />
          <ReportChart
            chart={{
              id: "renovaciones",
              kind: "bars",
              title: "Renovaciones exitosas y fallidas (12 meses)",
              format: "int",
              points: [
                { label: "Cobradas o regularizadas", value: months.reduce((n, p) => n + p.renewalsOk, 0) },
                { label: "Rechazadas", value: months.reduce((n, p) => n + p.renewalsFailed, 0) },
              ],
            }}
          />
        </div>
        <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface" role="region" aria-label="Tabla de métricas mensuales" tabIndex={0}>
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Métricas mensuales simuladas</caption>
            <thead className="border-b border-line bg-canvas text-left text-xs font-semibold text-muted uppercase">
              <tr>
                {["Mes", "Activas", "MRR", "Altas", "Cancelaciones", "Renov. cobradas", "Renov. rechazadas"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-line">
              {months.map((p) => (
                <tr key={p.month}>
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                    {month(p.month)}
                  </th>
                  <td className="px-4 py-2">{p.active}</td>
                  <td className="px-4 py-2">{formatCents(p.mrrCents, { compact: true })}</td>
                  <td className="px-4 py-2">{p.newSubscriptions}</td>
                  <td className="px-4 py-2">{p.cancellations}</td>
                  <td className="px-4 py-2">{p.renewalsOk}</td>
                  <td className="px-4 py-2">{p.renewalsFailed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="clientes" title="Clientes" description="Cuentas de facturación (organizaciones) con su suscripción vigente o la última. Las simulaciones no generan cargos.">
        <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface" role="region" aria-label="Clientes" tabIndex={0}>
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Clientes y suscripciones</caption>
            <thead className="border-b border-line bg-canvas text-left text-xs font-semibold text-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-2.5">
                  Organización
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Plan
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Estado
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  MRR
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Fin del periodo
                </th>
                <th scope="col" className="px-4 py-2.5">
                  Simular
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.map(({ account, subscription: s, plan, mrrCents, openInvoices }) => (
                <tr key={account.id} className="align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{account.legal_name}</span>
                    <span className="block text-xs text-muted">{account.billing_email}</span>
                  </td>
                  <td className="px-3 py-3 text-ink-soft">
                    {plan?.name ?? "—"}
                    {s ? <span className="block text-xs text-muted">{INTERVAL_LABEL[s.billing_interval]}{s.custom_price_cents !== null ? " · precio pactado" : ""}</span> : null}
                  </td>
                  <td className="px-3 py-3">
                    {s ? <SubscriptionStatusBadge status={s.status} cancelAtPeriodEnd={s.cancel_at_period_end} size="sm" /> : "—"}
                    {openInvoices ? <span className="mt-1 block text-xs text-amber-800">{openInvoices} comprobante(s) pendiente(s)</span> : null}
                  </td>
                  <td className="tabular px-3 py-3 text-right font-medium text-ink">{mrrCents ? formatCents(mrrCents, { compact: true }) : "—"}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-soft">{s ? date(s.status === "trialing" ? s.trial_ends_at : s.ended_at ?? s.current_period_end) : "—"}</td>
                  <td className="px-4 py-3">{s ? <AdminSimulationMenu subscriptionId={s.id} status={s.status} organization={account.legal_name} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="planes" title="Planes" description="Precios de demostración, beneficios y límites. Los cambios se reflejan de inmediato en /precios y en los permisos de cada espacio.">
        <div className="space-y-4">
          {plans.map((p) => (
            <details key={p.id} className="group rounded-2xl border border-line bg-surface [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
                <span className="font-semibold text-ink">
                  {p.name} {p.is_active ? null : <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">Inactivo</span>}
                </span>
                <span className="text-sm text-ink-soft">{p.monthly_price_cents === null ? "Precio personalizado" : `${formatCents(p.monthly_price_cents)}/mes · ${formatCents(p.annual_price_cents ?? 0)}/año`}</span>
              </summary>
              <div className="border-t border-line p-5">
                <AdminPlanEditor plan={p} features={[...FEATURES]} entitlements={entitlements.filter((e) => e.plan_id === p.id)} />
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section id="configuracion" title="Configuración comercial" description={`Descuento anual ${pct(settings.annual_discount_bps)} · gracia ${settings.grace_period_days} días · IVA ${pct(settings.tax_rate_bps)}.`}>
        <Card className="p-5">
          <AdminSettingsForm settings={settings} />
        </Card>
      </Section>

      <Section id="eventos" title="Eventos de facturación" description="Últimos eventos procesados (idempotentes por identificador de la pasarela).">
        <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface" role="region" aria-label="Eventos de facturación" tabIndex={0}>
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">Eventos de facturación</caption>
            <thead className="border-b border-line bg-canvas text-left text-xs font-semibold text-muted uppercase">
              <tr>
                {["Fecha", "Organización", "Evento", "Origen", "Estado", "Id de la pasarela"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.slice(0, 80).map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-ink-soft">{dateTime(e.created_at)}</td>
                  <td className="px-4 py-2 text-ink">{subOrg.get(e.subscription_id) ?? "—"}</td>
                  <td className="px-4 py-2 font-medium text-ink">{EVENT_LABEL[e.event_type] ?? e.event_type}</td>
                  <td className="px-4 py-2 text-ink-soft">{SOURCE[e.source] ?? e.source}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{e.from_status === e.to_status ? (e.to_status ?? "—") : `${e.from_status ?? "—"} → ${e.to_status}`}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{e.provider_event_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="auditoria" title="Historial administrativo" description="Cambios de precios, planes y simulaciones hechos por el equipo de la plataforma.">
        <Card>
          {audit.length ? (
            <ul className="divide-y divide-line">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    <span className="font-mono text-xs text-brand-800">{a.action}</span>
                    <span className="ml-2 text-ink-soft">{a.target_type === "subscription" ? (subOrg.get(a.target_id ?? "") ?? a.target_id) : a.target_type}</span>
                  </span>
                  <span className="text-muted">
                    {String(a.details.actor_email ?? "")} · {dateTime(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Sin operaciones registradas todavía.</p>
          )}
        </Card>
        {leads.length ? (
          <Card>
            <CardHeader title="Solicitudes del plan Corporativo" />
            <ul className="divide-y divide-line">
              {leads.map((l) => (
                <li key={l.id} className="px-5 py-3 text-sm">
                  <p className="font-medium text-ink">
                    {l.organization} · {l.workspaces} sede(s)
                  </p>
                  <p className="text-muted">
                    {l.name} · {l.email} · {dateTime(l.created_at)}
                  </p>
                  {l.message ? <p className="mt-1 text-ink-soft">{l.message}</p> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </Section>

      <Section id="avisos" title="Avisos generados" description="Correos que se enviarían a los clientes (bandeja de demostración; no salen).">
        <NotificationInbox
          items={notifications.map((n) => ({
            id: n.id,
            label: NOTIFICATION_TEMPLATES[n.template as TemplateKey] ?? n.template,
            subject: n.subject,
            recipient: n.recipient,
            dateLabel: dateTime(n.created_at),
            html: n.html,
            text: n.text,
            organization: n.billing_account_id ? accountName.get(n.billing_account_id) : undefined,
          }))}
        />
      </Section>

      <Section id="demo" title="Demostración" description="Vuelve a los datos ficticios iniciales de facturación.">
        <AdminResetButton />
      </Section>
    </div>
  );
}
