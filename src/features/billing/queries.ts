import "server-only";
import { cache } from "react";
import { quote } from "./pricing";
import { intervalFromParam, PERIOD_PARAM, planHighlights } from "./presenter";
import { buildBillingSeed } from "./seed";
import { billingEnabled, getBillingService, isBillingActive } from "./server";
import type { PlanOffer } from "./components/pricing-explorer";

/**
 * Catálogo para /precios y el paso 1. Con la facturación deshabilitada se
 * muestran los valores iniciales ilustrativos (sin contratación en línea).
 */
export const loadPublicCatalog = cache(async () => {
  const enabled = billingEnabled();
  const { plans, entitlements, settings } = enabled ? await getBillingService().getCatalog() : (() => {
    const seed = buildBillingSeed();
    return { plans: seed.plans, entitlements: seed.plan_entitlements, settings: seed.settings };
  })();
  const offers: PlanOffer[] = plans.map((plan, i) => ({
    plan: { id: plan.id, code: plan.code, name: plan.name, description: plan.description, badge: plan.badge, is_custom_pricing: plan.is_custom_pricing },
    quotes: { month: quote(plan, "month", settings), year: quote(plan, "year", settings) },
    highlights: planHighlights(plan, entitlements, i > 0 ? plans[i - 1] : null),
  }));
  return { enabled, plans, entitlements, settings, offers };
});

/** Plan y periodicidad de la URL de contratación (?plan=…&periodo=…). Solo planes contratables en línea. */
export async function resolveCheckoutPlan(params: Record<string, string | string[] | undefined>) {
  const catalog = await loadPublicCatalog();
  const code = typeof params.plan === "string" ? params.plan : "";
  const plan = catalog.plans.find((p) => p.code === code && !p.is_custom_pricing) ?? null;
  const interval = intervalFromParam(params.periodo);
  return { ...catalog, active: await isBillingActive(), plan, interval, query: plan ? `plan=${plan.code}&periodo=${PERIOD_PARAM[interval]}` : "" };
}
