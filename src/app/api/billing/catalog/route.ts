import { FEATURE_GROUPS, FEATURES } from "@/features/billing/catalog";
import { loadPublicCatalog } from "@/features/billing/queries";

/**
 * Catálogo público de planes (solo lectura) para el sitio público de Wattalis
 * (/planes). Expone lo mismo que /precios: planes activos, funciones, límites y
 * parámetros de precio. Nunca datos de clientes, suscripciones ni cobros.
 */
export async function GET() {
  const { plans, entitlements, settings, enabled } = await loadPublicCatalog();
  const active = plans.filter((p) => p.is_active);
  const codeOf = new Map(active.map((p) => [p.id, p.code]));
  return Response.json(
    {
      version: 1,
      demo: enabled,
      currency: "MXN",
      settings: {
        annual_discount_bps: settings.annual_discount_bps,
        tax_rate_bps: settings.tax_rate_bps,
        prices_include_tax: settings.prices_include_tax,
        grace_period_days: settings.grace_period_days,
        trial_days: settings.trial_days,
      },
      plans: active.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        badge: p.badge,
        tier: p.tier,
        monthly_price_cents: p.monthly_price_cents,
        annual_price_cents: p.annual_price_cents,
        is_custom_pricing: p.is_custom_pricing,
      })),
      entitlements: entitlements
        .filter((e) => codeOf.has(e.plan_id) && e.enabled)
        .map((e) => ({ plan_code: codeOf.get(e.plan_id)!, feature_code: e.feature_code, usage_limit: e.usage_limit })),
      features: FEATURES.map((f) => ({ code: f.code, label: f.label, kind: f.kind, group: f.group, hint: "hint" in f ? f.hint : null, soon: "soon" in f ? Boolean(f.soon) : false })),
      groups: FEATURE_GROUPS,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
