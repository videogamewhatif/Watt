import { CalendarClock, Check, CreditCard, Lock } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/layout";
import { FEATURES } from "@/features/billing/catalog";
import { CurrentPlanCard } from "@/features/billing/components/current-plan-card";
import { PlanActions, UndoScheduledChange } from "@/features/billing/components/plan-actions";
import { PlanUsageIndicator } from "@/features/billing/components/plan-usage-indicator";
import { lostFeatures } from "@/features/billing/entitlements";
import { featureLabel, PERIOD_PARAM } from "@/features/billing/presenter";
import { STATUS_INFO } from "@/features/billing/state-machine";
import { formatDate, loadWorkspaceBilling } from "@/features/billing/workspace";

export const metadata: Metadata = { title: "Mi plan" };

const ALERT_TONE = { success: "success", info: "info", warning: "warning", error: "error", neutral: "info" } as const;

export default async function MyPlanPage() {
  const data = await loadWorkspaceBilling();
  if (!data) return null;
  const { ctx, overview, usage, catalog, offers } = data;
  const { subscription: sub, plan, settings, entitlements, scheduledChange, paymentMethods } = overview;
  const tz = overview.account?.timezone ?? ctx.workspace.timezone;

  if (!sub || !plan) {
    return (
      <Card>
        <EmptyState
          icon={<CreditCard className="size-6" aria-hidden />}
          title="Este espacio aún no tiene un plan"
          action={<LinkButton href="/suscripcion/seleccionar">Elegir un plan</LinkButton>}
        >
          Puedes consultar y exportar tu información. Contrata un plan para volver a registrar citas, profesionales y usuarios.
        </EmptyState>
      </Card>
    );
  }

  const info = STATUS_INFO[sub.status];
  const terminal = sub.status === "canceled" || sub.status === "expired";
  const next = terminal
    ? { title: "Terminó el", label: formatDate(sub.ended_at ?? sub.canceled_at, tz) }
    : sub.cancel_at_period_end
      ? { title: "Acceso hasta", label: formatDate(sub.current_period_end, tz) }
      : sub.status === "trialing"
        ? { title: "Fin del periodo de prueba", label: formatDate(sub.trial_ends_at, tz) }
        : sub.status === "grace_period"
          ? { title: "Periodo de gracia hasta", label: formatDate(sub.grace_ends_at, tz) }
          : sub.status === "incomplete"
            ? { title: "Próxima renovación", label: "Al completar el pago" }
            : { title: "Próxima renovación", label: formatDate(sub.current_period_end, tz) };
  const detail =
    sub.cancel_at_period_end && !terminal
      ? `Cancelaste la renovación. Conservas el acceso completo hasta el ${formatDate(sub.current_period_end, tz)}; después el espacio quedará en modo de consulta sin perder información.`
      : sub.status === "trialing"
        ? `${info.message} Tu prueba termina el ${formatDate(sub.trial_ends_at, tz)}.`
        : sub.status === "grace_period"
          ? `${info.message} Fin del periodo de gracia: ${formatDate(sub.grace_ends_at, tz)}.`
          : info.message;
  const reactivateHref = plan.is_custom_pricing ? "/precios#corporativo" : `/suscripcion/resumen?plan=${plan.code}&periodo=${PERIOD_PARAM[sub.billing_interval]}&espacio=${ctx.workspace.id}`;
  const defaultMethod = paymentMethods.find((m) => m.is_default) ?? null;

  const own = new Set(overview.planEntitlements.filter((e) => e.enabled).map((e) => e.feature_code));
  const included = FEATURES.filter((f) => f.kind === "feature" && own.has(f.code));
  const notIncluded = FEATURES.filter((f) => f.kind === "feature" && !own.has(f.code)).map((f) => {
    const upgrade = catalog.plans.filter((p) => p.tier > plan.tier).find((p) => catalog.entitlements.some((e) => e.plan_id === p.id && e.feature_code === f.code && e.enabled));
    return { code: f.code, plan: upgrade?.name ?? null };
  });
  const changeLost = scheduledChange ? lostFeatures(overview.planEntitlements, catalog.entitlements.filter((e) => e.plan_id === scheduledChange.to_plan_id)) : [];
  const targetLimits = scheduledChange ? catalog.entitlements.filter((e) => e.plan_id === scheduledChange.to_plan_id) : [];
  const overAfterChange = scheduledChange
    ? (["professionals.max", "users.max"] as const)
        .map((code) => ({ code, limit: targetLimits.find((e) => e.feature_code === code)?.usage_limit ?? null, used: code === "professionals.max" ? usage.professionals : usage.users }))
        .filter((x) => x.limit !== null && x.used > x.limit)
    : [];

  return (
    <div className="space-y-6">
      {overview.centrallyBilled ? (
        <Alert tone="info" title="Facturación centralizada">
          Este espacio está cubierto por la suscripción corporativa de {overview.account?.legal_name}. Los cambios de plan y pagos los hace la cuenta corporativa.
        </Alert>
      ) : null}
      {sub.status !== "active" || sub.cancel_at_period_end ? (
        <Alert tone={sub.cancel_at_period_end && !terminal ? "warning" : ALERT_TONE[info.tone]} title={sub.cancel_at_period_end && !terminal ? "La suscripción no se renovará" : info.label}>
          {detail}
        </Alert>
      ) : null}

      <CurrentPlanCard
        plan={plan}
        subscription={sub}
        periodPriceCents={overview.periodPriceCents ?? 0}
        settings={settings}
        since={formatDate(sub.created_at, tz)}
        nextDateTitle={next.title}
        nextDateLabel={next.label}
        defaultMethod={defaultMethod}
        actions={
          overview.centrallyBilled ? null : (
            <PlanActions
              organizationId={ctx.workspace.id}
              status={sub.status}
              cancelAtPeriodEnd={sub.cancel_at_period_end}
              actions={info.actions}
              planName={plan.name}
              accessUntilLabel={sub.current_period_end ? formatDate(sub.current_period_end, tz) : null}
              plans={offers}
              currentPlanCode={plan.code}
              currentInterval={sub.billing_interval}
              discountBps={settings.annual_discount_bps}
              timezone={tz}
              reactivateHref={reactivateHref}
              manageHref="/configuracion/suscripcion/metodos-de-pago"
            />
          )
        }
      />

      {scheduledChange ? (
        <section aria-labelledby="cambio-programado" className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <h2 id="cambio-programado" className="font-semibold">
                  Cambio programado al plan {scheduledChange.toPlan.name}
                </h2>
                <p className="mt-0.5 text-sm">Entra en vigor el {formatDate(scheduledChange.effective_at, tz)}. Hasta entonces conservas tu plan actual.</p>
                {changeLost.length ? <p className="mt-2 text-sm">Se restringirán: {changeLost.map(featureLabel).join(", ")}. La información se conserva.</p> : null}
                {overAfterChange.length ? (
                  <p className="mt-2 text-sm font-medium">
                    {overAfterChange.map((o) => `Tienes ${o.used} y el nuevo plan permite ${o.limit} ${o.code === "professionals.max" ? "profesionales" : "usuarios"}`).join(". ")}. No se borrará nada; no podrás agregar más hasta quedar dentro del límite.
                  </p>
                ) : null}
              </div>
            </div>
            <UndoScheduledChange organizationId={ctx.workspace.id} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="uso" className="space-y-3">
        <h2 id="uso" className="text-base font-semibold text-ink">
          Uso del plan
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <PlanUsageIndicator label="Profesionales activos" used={usage.professionals} limit={entitlements.limits["professionals.max"]} unit="profesionales" />
          <PlanUsageIndicator label="Usuarios internos" used={usage.users} limit={entitlements.limits["users.max"]} unit="usuarios" />
        </div>
        <p className="text-xs text-muted">Usuarios internos: miembros del espacio más invitaciones vigentes.</p>
      </section>

      <Card>
        <CardHeader title="Funciones de tu plan" description="Lo que incluye tu plan y lo que está disponible en planes superiores." />
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <ul className="space-y-2 text-sm">
            {included.map((f) => (
              <li key={f.code} className="flex gap-2 text-ink-soft">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                {featureLabel(f.code)}
              </li>
            ))}
          </ul>
          {notIncluded.length ? (
            <ul className="space-y-2 text-sm">
              {notIncluded.map((f) => (
                <li key={f.code} className="flex gap-2 text-muted">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {featureLabel(f.code)}
                    {f.plan ? <span className="block text-xs">Disponible en el plan {f.plan}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Tu plan incluye todas las funciones.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
