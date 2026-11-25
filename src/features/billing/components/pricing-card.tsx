import { Check, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { formatCents, type Quote } from "../pricing";
import type { BillingInterval, PlanRow } from "../types";

type PricingCardProps = {
  plan: Pick<PlanRow, "code" | "name" | "description" | "badge" | "is_custom_pricing">;
  interval: BillingInterval;
  quote: Quote | null;
  highlights: { intro: string | null; items: string[] };
  /** Botón o enlace de acción. */
  cta: ReactNode;
  featured?: boolean;
  selected?: boolean;
  /** Elemento de encabezado (h2/h3) según la página. */
  headingLevel?: "h2" | "h3";
};

/** Tarjeta de un plan: precio claro, periodicidad real del cobro y beneficios. */
export function PricingCard({ plan, interval, quote, highlights, cta, featured = false, selected = false, headingLevel = "h3" }: PricingCardProps) {
  const Heading = headingLevel;
  const headingId = `plan-${plan.code}`;
  return (
    <article
      aria-labelledby={headingId}
      className={`relative flex h-full flex-col rounded-2xl border bg-surface p-6 transition-[transform,box-shadow,border-color] duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-lg ${
        featured ? "border-brand-600 shadow-md ring-1 ring-brand-600" : "border-line"
      } ${selected ? "ring-2 ring-brand-700" : ""}`}
    >
      {plan.badge ? (
        <p className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-brand-700 px-3 py-1 text-xs font-semibold text-white shadow">
          <Sparkles className="size-3.5" aria-hidden />
          {plan.badge}
        </p>
      ) : null}
      <Heading id={headingId} className="text-lg font-semibold text-ink">
        {plan.name}
      </Heading>
      <p className="mt-1 min-h-10 text-sm text-muted">{plan.description}</p>

      <div className="mt-5 min-h-24" aria-live="polite">
        {quote ? (
          <>
            <p className="flex items-baseline gap-1">
              <span className="tabular text-4xl font-semibold tracking-tight text-ink">{formatCents(quote.monthlyEquivalentCents, { compact: true })}</span>
              <span className="text-sm text-muted">MXN/mes</span>
            </p>
            {interval === "year" ? (
              <p className="mt-1 text-sm text-ink-soft">
                <span className="font-medium">{formatCents(quote.periodPriceCents)} MXN</span> cobrados una vez al año
                {quote.annualSavingsCents > 0 ? (
                  <span className="mt-1 block w-fit rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    Ahorras {formatCents(quote.annualSavingsCents)} al año
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">Cobro mensual · {formatCents(quote.listAnnualCents, { compact: true })} al año</p>
            )}
            <p className="mt-1 text-xs text-muted">{quote.tax.included ? "IVA incluido" : `Más IVA (${quote.tax.taxRateBps / 100} %)`}</p>
          </>
        ) : (
          <>
            <p className="text-2xl font-semibold tracking-tight text-ink">Precio personalizado</p>
            <p className="mt-1 text-sm text-ink-soft">Según sedes, usuarios e integraciones.</p>
          </>
        )}
      </div>

      <div className="mt-5">{cta}</div>

      <div className="mt-6 border-t border-line pt-5">
        {highlights.intro ? <p className="mb-3 text-sm font-medium text-ink">{highlights.intro}</p> : null}
        <ul className="space-y-2.5 text-sm text-ink-soft">
          {highlights.items.map((item) => (
            <li key={item} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
