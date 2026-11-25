// Suscripciones · componentes: accesibilidad básica, diseño responsive (sin
// desplazamiento horizontal de página), restricciones y compatibilidad.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => h("a", { href, ...rest }, children) }));

const { PricingComparison } = await import("@/features/billing/components/pricing-comparison");
const { SubscriptionCheckoutStepper } = await import("@/features/billing/components/subscription-checkout-stepper");
const { BillingIntervalToggle } = await import("@/features/billing/components/billing-interval-toggle");
const { SubscriptionStatusBadge } = await import("@/features/billing/components/subscription-status-badge");
const { SubscriptionFeatureGate } = await import("@/features/billing/components/subscription-feature-gate");
const { PlanUsageIndicator } = await import("@/features/billing/components/plan-usage-indicator");
const { resolveEntitlements, UNMANAGED } = await import("@/features/billing/entitlements");
const { SUBSCRIPTION_STATUSES, STATUS_INFO } = await import("@/features/billing/state-machine");
const { buildBillingSeed } = await import("@/features/billing/seed");
const { navigationFor, permissionsFor } = await import("@/lib/permissions");
const { isPublicPath } = await import("@/lib/supabase/proxy");

const seed = buildBillingSeed(new Date("2026-11-24T00:00:00Z"));
const entsFor = (code: string, status: "active" | "unpaid" = "active") => {
  const plan = seed.plans.find((p) => p.code === code)!;
  return resolveEntitlements({ subscription: { status }, plan, planEntitlements: seed.plan_entitlements.filter((e) => e.plan_id === plan.id), enforced: true });
};

describe("tabla comparativa (responsive y accesible)", () => {
  const html = renderToStaticMarkup(h(PricingComparison, { plans: seed.plans, entitlements: seed.plan_entitlements, highlightCode: "profesional" }));

  it("tiene título, encabezados de fila y columna y texto para lectores de pantalla", () => {
    expect(html).toContain("<caption");
    expect(html.match(/scope="col"/g)?.length).toBe(seed.plans.length + 1);
    expect(html).toContain('scope="row"');
    expect(html).toContain("Incluido");
    expect(html).toContain("No incluido");
  });

  it("se desplaza dentro de su propio contenedor, enfocable con teclado y sin desbordar la página", () => {
    // `relative` contiene los textos sr-only (absolutos); sin él la página se desplazaba de lado en teléfonos.
    expect(html).toMatch(/class="relative overflow-x-auto[^"]*" tabindex="0" role="region" aria-labelledby="comparativa-titulo"/);
    expect(html).toContain("min-w-[640px]");
    expect(html).toContain("sticky left-0");
  });

  it("marca las funciones que aún no existen como «Próximamente»", () => {
    expect(html).toContain("Próximamente");
  });
});

describe("etapas de la contratación", () => {
  it("marca la etapa actual y muestra el avance compacto en teléfonos", () => {
    const html = renderToStaticMarkup(h(SubscriptionCheckoutStepper, { current: 3 }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("Paso 3 de 6");
    expect(html).toContain("(completado)");
    expect(html).toContain('aria-label="Etapas de la contratación"');
  });
});

describe("selector mensual/anual", () => {
  it("es un grupo de radios con leyenda y anuncia el cambio", () => {
    const html = renderToStaticMarkup(h(BillingIntervalToggle, { value: "year", onChange: () => {}, discountBps: 1500 }));
    expect(html).toContain("<fieldset");
    expect(html).toContain("Periodicidad de facturación");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("−15 %");
  });
});

describe("estado de la suscripción", () => {
  it("cada estado tiene texto (no solo color)", () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      const html = renderToStaticMarkup(h(SubscriptionStatusBadge, { status }));
      expect(html).toContain(STATUS_INFO[status].label);
    }
    expect(renderToStaticMarkup(h(SubscriptionStatusBadge, { status: "active", cancelAtPeriodEnd: true }))).toContain("No se renovará");
  });

  it("el indicador de uso expone su valor como medidor", () => {
    const html = renderToStaticMarkup(h(PlanUsageIndicator, { label: "Profesionales activos", used: 7, limit: 5, unit: "profesionales" }));
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain("No se elimina nada");
  });
});

describe("SubscriptionFeatureGate", () => {
  const child = h("p", null, "contenido protegido");

  it("muestra el contenido cuando el plan lo incluye", () => {
    const html = renderToStaticMarkup(h(SubscriptionFeatureGate, { entitlements: entsFor("profesional"), feature: "reports.financial", canManageBilling: true, children: child }));
    expect(html).toContain("contenido protegido");
  });

  it("restringe de forma consistente cuando el plan no lo incluye, con camino según el rol", () => {
    const admin = renderToStaticMarkup(h(SubscriptionFeatureGate, { entitlements: entsFor("esencial"), feature: "reports.financial", canManageBilling: true, children: child }));
    expect(admin).not.toContain("contenido protegido");
    expect(admin).toContain('role="note"');
    expect(admin).toContain("El plan Esencial no incluye «Reportes financieros»");
    expect(admin).toContain('href="/configuracion/suscripcion"');
    const reception = renderToStaticMarkup(h(SubscriptionFeatureGate, { entitlements: entsFor("esencial"), feature: "reports.financial", canManageBilling: false, children: child }));
    expect(reception).toContain("Pide a la Administración");
    expect(reception).not.toContain("/configuracion/suscripcion");
  });

  it("aplica límites de uso y el modo de consulta", () => {
    const limit = renderToStaticMarkup(h(SubscriptionFeatureGate, { entitlements: entsFor("esencial"), limit: { code: "professionals.max", usage: 1 }, canManageBilling: true, children: child }));
    expect(limit).toContain("hasta 1 profesional activo");
    const readOnly = renderToStaticMarkup(h(SubscriptionFeatureGate, { entitlements: entsFor("profesional", "unpaid"), feature: "module.agenda", write: true, canManageBilling: true, children: child }));
    expect(readOnly).toContain("modo de consulta");
  });

  it("compatibilidad: sin facturación habilitada no restringe nada", () => {
    const html = renderToStaticMarkup(h(SubscriptionFeatureGate, { entitlements: UNMANAGED, feature: "reports.advanced", limit: { code: "professionals.max", usage: 999 }, write: true, canManageBilling: false, children: child }));
    expect(html).toContain("contenido protegido");
  });
});

describe("navegación y rutas", () => {
  it("Configuración → Suscripción y facturación solo para Administración, sin cambiar el menú principal", () => {
    const settings = (role: Parameters<typeof navigationFor>[0]) => navigationFor(role).find((i) => i.href === "/configuracion");
    expect(settings("admin")?.children?.map((c) => c.label)).toEqual(["General", "Suscripción y facturación"]);
    expect(settings("admin")?.children?.[1].alsoActive).toContain("/configuracion/facturacion");
    expect(settings("reception")?.children).toBeUndefined();
    expect(settings("professional")?.children).toBeUndefined();
    expect(permissionsFor("admin").manageBilling).toBe(true);
    expect(permissionsFor("reception").manageBilling).toBe(false);
  });

  it("/precios y los primeros pasos son públicos; el resto exige sesión", () => {
    for (const p of ["/precios", "/suscripcion/seleccionar", "/suscripcion/registro", "/api/billing/webhook", "/api/billing/catalog"]) expect(isPublicPath(p), p).toBe(true);
    for (const p of ["/suscripcion/organizacion", "/suscripcion/resumen", "/suscripcion/pago", "/suscripcion/confirmacion", "/configuracion/suscripcion", "/admin/suscripciones"]) expect(isPublicPath(p), p).toBe(false);
  });
});
