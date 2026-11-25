import type { ReactNode } from "react";
import { formatCents, INTERVAL_LABEL, INTERVAL_UNIT, taxBreakdown } from "../pricing";
import type { BillingSettingsRow, PaymentMethodRow, PlanRow, SubscriptionRow } from "../types";
import { SubscriptionStatusBadge } from "./subscription-status-badge";

/** Tarjeta principal de «Mi plan»: plan, estado, precio, fechas y acciones. */
export function CurrentPlanCard({
  plan,
  subscription,
  periodPriceCents,
  settings,
  since,
  nextDateLabel,
  nextDateTitle,
  defaultMethod,
  actions,
}: {
  plan: PlanRow;
  subscription: SubscriptionRow;
  periodPriceCents: number;
  settings: BillingSettingsRow;
  since: string;
  nextDateLabel: string;
  nextDateTitle: string;
  defaultMethod: PaymentMethodRow | null;
  actions: ReactNode;
}) {
  const total = taxBreakdown(periodPriceCents, settings).totalCents;
  return (
    <section aria-labelledby="mi-plan" className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="bg-gradient-to-br from-brand-800 to-brand-600 px-5 py-6 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-brand-100">Tu plan</p>
            <h2 id="mi-plan" className="text-2xl font-semibold tracking-tight">
              {plan.name}
            </h2>
            <p className="text-sm text-brand-100">{plan.description}</p>
          </div>
          <div className="rounded-full bg-white p-0.5">
            <SubscriptionStatusBadge status={subscription.status} cancelAtPeriodEnd={subscription.cancel_at_period_end} />
          </div>
        </div>
        <p className="mt-4 flex items-baseline gap-1.5">
          <span className="tabular text-3xl font-semibold">{formatCents(total)}</span>
          <span className="text-sm text-brand-100">
            MXN / {INTERVAL_UNIT[subscription.billing_interval]} · {INTERVAL_LABEL[subscription.billing_interval].toLowerCase()}
            {subscription.custom_price_cents !== null ? " · precio pactado" : ""}
          </span>
        </p>
      </div>
      <dl className="grid gap-4 border-b border-line px-5 py-5 text-sm sm:grid-cols-3 sm:px-6">
        <div>
          <dt className="text-muted">Contratado desde</dt>
          <dd className="mt-0.5 font-medium text-ink">{since}</dd>
        </div>
        <div>
          <dt className="text-muted">{nextDateTitle}</dt>
          <dd className="mt-0.5 font-medium text-ink">{nextDateLabel}</dd>
        </div>
        <div>
          <dt className="text-muted">Método de pago</dt>
          <dd className="mt-0.5 font-medium text-ink">{defaultMethod ? `${defaultMethod.brand} ···· ${defaultMethod.last4} (prueba)` : "Sin método registrado"}</dd>
        </div>
      </dl>
      <div className="px-5 py-4 sm:px-6">{actions}</div>
    </section>
  );
}
