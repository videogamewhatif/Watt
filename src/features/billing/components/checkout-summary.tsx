import { Check, RefreshCcw } from "lucide-react";
import { formatCents, INTERVAL_LABEL, INTERVAL_UNIT, pct, type Quote } from "../pricing";
import type { BillingInterval, PlanRow } from "../types";

/** Resumen del pedido: qué se contrata, cuánto, impuestos, total y cómo se renueva. */
export function CheckoutSummary({
  plan,
  interval,
  quote,
  organizationName,
  features,
  renewalLabel,
  discountBps,
}: {
  plan: Pick<PlanRow, "name" | "description">;
  interval: BillingInterval;
  quote: Quote;
  organizationName: string;
  features: string[];
  renewalLabel: string;
  discountBps: number;
}) {
  const unit = INTERVAL_UNIT[interval];
  return (
    <section aria-labelledby="resumen-titulo" className="rounded-2xl border border-line bg-surface">
      <div className="border-b border-line p-5 sm:p-6">
        <p className="text-sm text-muted">{organizationName}</p>
        <h2 id="resumen-titulo" className="mt-0.5 text-xl font-semibold text-ink">
          Plan {plan.name}
        </h2>
        <p className="text-sm text-muted">{plan.description}</p>
        <ul className="mt-4 grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
          {features.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <dl className="space-y-3 p-5 text-sm sm:p-6">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Periodicidad</dt>
          <dd className="font-medium text-ink">
            {INTERVAL_LABEL[interval]} · un cargo cada {unit}
          </dd>
        </div>
        {interval === "year" ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Precio de lista (12 meses)</dt>
              <dd className="tabular text-ink">{formatCents(quote.listAnnualCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Descuento anual ({pct(discountBps)})</dt>
              <dd className="tabular font-medium text-emerald-800">−{formatCents(quote.annualSavingsCents)}</dd>
            </div>
          </>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Subtotal{quote.tax.included ? " (sin IVA)" : ""}</dt>
          <dd className="tabular text-ink">{formatCents(quote.tax.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">
            IVA ({pct(quote.tax.taxRateBps)}){quote.tax.included ? " incluido" : ""}
          </dt>
          <dd className="tabular text-ink">{formatCents(quote.tax.taxCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="font-semibold text-ink">Total a pagar hoy</dt>
          <dd className="tabular text-2xl font-semibold text-ink">
            {formatCents(quote.tax.totalCents)} <span className="text-sm font-normal text-muted">MXN</span>
          </dd>
        </div>
        {interval === "year" ? <p className="text-right text-xs text-muted">Equivale a {formatCents(quote.monthlyEquivalentCents)} al mes (referencia; el cargo es anual).</p> : null}
      </dl>

      <div className="flex gap-3 rounded-b-2xl border-t border-line bg-canvas p-5 text-sm text-ink-soft sm:p-6">
        <RefreshCcw className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
        <p>
          <span className="font-medium text-ink">Renovación automática.</span> Próxima renovación estimada: <span className="font-medium text-ink">{renewalLabel}</span>, por{" "}
          {formatCents(quote.tax.totalCents)} MXN cada {unit} hasta que la canceles. Puedes cancelar cuando quieras desde Configuración; conservas el acceso hasta el final del periodo pagado y tu
          información nunca se borra.
        </p>
      </div>
    </section>
  );
}
