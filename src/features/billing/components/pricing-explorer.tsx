"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import type { Quote } from "../pricing";
import type { BillingInterval, PlanRow } from "../types";
import { BillingIntervalToggle } from "./billing-interval-toggle";
import { PricingCard } from "./pricing-card";

export type PlanOffer = {
  plan: Pick<PlanRow, "id" | "code" | "name" | "description" | "badge" | "is_custom_pricing">;
  quotes: Record<BillingInterval, Quote | null>;
  highlights: { intro: string | null; items: string[] };
};

/** Selector de periodicidad + tarjetas de planes (página pública de precios). */
export function PricingExplorer({ offers, discountBps, initialInterval = "month" }: { offers: PlanOffer[]; discountBps: number; initialInterval?: BillingInterval }) {
  const [interval, setPeriod] = useState<BillingInterval>(initialInterval);
  const period = interval === "year" ? "anual" : "mensual";
  return (
    <div className="space-y-10">
      <div className="flex justify-center">
        <BillingIntervalToggle value={interval} onChange={setPeriod} discountBps={discountBps} />
      </div>
      <ul className="grid gap-6 pt-3 md:grid-cols-2 xl:grid-cols-4">
        {offers.map(({ plan, quotes, highlights }) => {
          const featured = Boolean(plan.badge);
          const cta = plan.is_custom_pricing ? (
            <a href="#corporativo" className={buttonClass("secondary", "md", "w-full")}>
              Hablar con ventas
            </a>
          ) : (
            <Link
              href={`/suscripcion/seleccionar?plan=${plan.code}&periodo=${period}`}
              className={buttonClass(featured ? "primary" : "secondary", "md", "group w-full")}
              aria-label={`Elegir el plan ${plan.name} con facturación ${period}`}
            >
              Elegir {plan.name}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          );
          return (
            <li key={plan.id}>
              <PricingCard plan={plan} interval={interval} quote={quotes[interval]} highlights={highlights} featured={featured} cta={cta} headingLevel="h3" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
