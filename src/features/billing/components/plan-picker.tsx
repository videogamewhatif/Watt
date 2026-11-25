"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { formatCents, INTERVAL_UNIT } from "../pricing";
import type { BillingInterval } from "../types";
import { BillingIntervalToggle } from "./billing-interval-toggle";
import type { PlanOffer } from "./pricing-explorer";

/** Paso 1: elegir plan y periodicidad. Corporativo se atiende con ventas. */
export function PlanPicker({ offers, initialPlan, initialInterval, discountBps, nextPath }: { offers: PlanOffer[]; initialPlan: string | null; initialInterval: BillingInterval; discountBps: number; nextPath: string }) {
  const purchasable = offers.filter((o) => !o.plan.is_custom_pricing);
  const [plan, setPlan] = useState(purchasable.find((o) => o.plan.code === initialPlan)?.plan.code ?? purchasable.find((o) => o.plan.badge)?.plan.code ?? purchasable[0]?.plan.code);
  const [period, setPeriod] = useState<BillingInterval>(initialInterval);
  const selected = purchasable.find((o) => o.plan.code === plan);
  const q = selected?.quotes[period];
  const href = `${nextPath}?plan=${plan}&periodo=${period === "year" ? "anual" : "mensual"}`;

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <BillingIntervalToggle value={period} onChange={setPeriod} discountBps={discountBps} />
      </div>
      <fieldset>
        <legend className="sr-only">Plan</legend>
        <div className="grid gap-4 md:grid-cols-3">
          {purchasable.map(({ plan: p, quotes, highlights }) => {
            const quote = quotes[period];
            const checked = p.code === plan;
            return (
              <label
                key={p.code}
                className={`relative flex cursor-pointer flex-col rounded-2xl border bg-surface p-5 transition-[box-shadow,border-color,transform] duration-200 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-focus)] motion-safe:hover:-translate-y-0.5 ${
                  checked ? "border-brand-600 shadow-md ring-2 ring-brand-600" : "border-line hover:border-brand-300"
                }`}
              >
                <input type="radio" name="plan" value={p.code} checked={checked} onChange={() => setPlan(p.code)} className="sr-only" />
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-base font-semibold text-ink">{p.name}</span>
                    <span className="block text-sm text-muted">{p.description}</span>
                  </span>
                  <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors ${checked ? "border-brand-700 bg-brand-700 text-white" : "border-line-strong"}`}>
                    {checked ? <Check className="size-3.5" /> : null}
                  </span>
                </span>
                {p.badge ? <span className="mt-2 w-fit rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">{p.badge}</span> : null}
                {quote ? (
                  <span className="mt-4 block">
                    <span className="tabular text-2xl font-semibold text-ink">{formatCents(quote.periodPriceCents, { compact: true })}</span>
                    <span className="text-sm text-muted"> MXN/{INTERVAL_UNIT[period]}</span>
                    {period === "year" ? <span className="block text-xs text-muted">Equivale a {formatCents(quote.monthlyEquivalentCents)} al mes · ahorras {formatCents(quote.annualSavingsCents)}</span> : null}
                  </span>
                ) : null}
                <ul className="mt-4 space-y-1.5 text-sm text-ink-soft">
                  {highlights.items.slice(0, 4).map((item) => (
                    <li key={item} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft" aria-live="polite">
            {selected && q ? (
              <>
                <span className="font-semibold text-ink">Plan {selected.plan.name}</span> · {formatCents(q.periodPriceCents)} MXN cada {INTERVAL_UNIT[period]}
                <span className="text-muted"> · {q.tax.included ? "IVA incluido" : "más IVA"}</span>
              </>
            ) : (
              "Elige un plan"
            )}
          </p>
          <Link href={href} className={buttonClass("primary", "md", "group w-full sm:w-auto")}>
            Continuar
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </div>
      <p className="text-center text-sm text-muted">
        ¿Un hospital o un grupo médico?{" "}
        <Link href="/precios#corporativo" className="font-medium text-brand-700 hover:underline">
          Conoce el plan Corporativo
        </Link>
      </p>
    </div>
  );
}
