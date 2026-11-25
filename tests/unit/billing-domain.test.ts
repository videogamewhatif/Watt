// Suscripciones · reglas puras: importes, periodicidad, máquina de estados y límites.
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, DEFAULT_SETTINGS, FEATURES, pricingFaq } from "@/features/billing/catalog";
import { checkFeature, checkLimit, noSubscription, resolveEntitlements, UNMANAGED } from "@/features/billing/entitlements";
import { renderEmail, NOTIFICATION_TEMPLATES, type TemplateKey } from "@/features/billing/notifications";
import { addInterval, annualFromMonthly, formatCents, prorate, quote, taxBreakdown } from "@/features/billing/pricing";
import { allowedStatusPairs, canTransition, InvalidTransitionError, STATUS_INFO, SUBSCRIPTION_STATUSES, transition } from "@/features/billing/state-machine";
import { buildBillingSeed } from "@/features/billing/seed";

const settings = { tax_rate_bps: 1600, prices_include_tax: true };
const plan = (monthly: number | null) => ({
  monthly_price_cents: monthly,
  annual_price_cents: monthly === null ? null : annualFromMonthly(monthly, 1500),
  is_custom_pricing: monthly === null,
});

describe("catálogo inicial (ilustrativo y configurable)", () => {
  it("tiene los cuatro planes del requerimiento, con Profesional como «Más popular»", () => {
    expect(DEFAULT_PLANS.map((p) => [p.code, p.monthly_price_cents])).toEqual([
      ["esencial", 39_900],
      ["profesional", 89_900],
      ["empresarial", 199_900],
      ["corporativo", null],
    ]);
    expect(DEFAULT_PLANS.filter((p) => p.badge).map((p) => p.code)).toEqual(["profesional"]);
    expect(DEFAULT_SETTINGS).toMatchObject({ annual_discount_bps: 1500, grace_period_days: 7 });
  });

  it("todas las funciones de los planes existen en el catálogo de funciones", () => {
    const codes = new Set(FEATURES.map((f) => f.code));
    for (const p of DEFAULT_PLANS) {
      for (const f of p.features) expect(codes.has(f), `${p.code}:${f}`).toBe(true);
      for (const l of Object.keys(p.limits)) expect(codes.has(l as never), `${p.code}:${l}`).toBe(true);
    }
  });

  it("las preguntas frecuentes reflejan la configuración vigente de impuestos y gracia", () => {
    const faq = pricingFaq({ prices_include_tax: false, tax_rate_bps: 1600, grace_period_days: 10 });
    expect(faq.find((f) => f.q.includes("impuestos"))?.a).toContain("se suma el IVA");
    expect(faq.find((f) => f.q.includes("pago no se procesa"))?.a).toContain("10 días");
  });
});

describe("facturación mensual y anual", () => {
  it("mensual: cobra el precio de lista cada mes", () => {
    const q = quote(plan(89_900), "month", settings)!;
    expect(q).toMatchObject({ periodPriceCents: 89_900, monthlyEquivalentCents: 89_900, annualSavingsCents: 0 });
  });

  it("anual: 15 % de descuento, cobro único, equivalente mensual y ahorro exactos en centavos", () => {
    const q = quote(plan(89_900), "year", settings)!;
    expect(q.listAnnualCents).toBe(1_078_800);
    expect(q.periodPriceCents).toBe(916_980);
    expect(q.monthlyEquivalentCents).toBe(76_415);
    expect(q.annualSavingsCents).toBe(161_820);
    expect(q.discountBps).toBe(1500);
    expect(formatCents(q.periodPriceCents)).toBe("$9,169.80");
  });

  it("el descuento es configurable", () => {
    expect(annualFromMonthly(39_900, 0)).toBe(478_800);
    expect(annualFromMonthly(39_900, 2000)).toBe(383_040);
  });

  it("un plan con precio personalizado no tiene cotización automática", () => {
    expect(quote(plan(null), "month", settings)).toBeNull();
  });
});

describe("cálculo de importes", () => {
  it("IVA incluido: separa la base sin cambiar el total; IVA adicional: lo suma", () => {
    expect(taxBreakdown(89_900, { tax_rate_bps: 1600, prices_include_tax: true })).toEqual({ subtotalCents: 77_500, taxCents: 12_400, totalCents: 89_900, taxRateBps: 1600, included: true });
    expect(taxBreakdown(89_900, { tax_rate_bps: 1600, prices_include_tax: false })).toEqual({ subtotalCents: 89_900, taxCents: 14_384, totalCents: 104_284, taxRateBps: 1600, included: false });
  });

  it("los importes son siempre enteros y la suma cuadra", () => {
    for (const cents of [1, 99, 39_900, 916_980, 1_234_567]) {
      const t = taxBreakdown(cents, settings);
      expect(Number.isInteger(t.subtotalCents) && Number.isInteger(t.taxCents)).toBe(true);
      expect(t.subtotalCents + t.taxCents).toBe(t.totalCents);
    }
  });

  it("prorrateo de una mejora a mitad del periodo", () => {
    const p = prorate({ currentPriceCents: 39_900, newPriceCents: 89_900, periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z", now: "2026-11-16T00:00:00Z", intervalChanges: false });
    expect(p.remainingFraction).toBeCloseTo(0.5, 5);
    expect(p).toMatchObject({ creditCents: 19_950, chargeCents: 44_950, amountDueCents: 25_000, restartsPeriod: false });
  });

  it("si cambia la periodicidad, el nuevo periodo empieza hoy con crédito por lo no usado", () => {
    const p = prorate({ currentPriceCents: 89_900, newPriceCents: 916_980, periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z", now: "2026-11-16T00:00:00Z", intervalChanges: true });
    expect(p).toMatchObject({ creditCents: 44_950, chargeCents: 916_980, amountDueCents: 872_030, restartsPeriod: true });
  });

  it("los periodos respetan fin de mes y años", () => {
    expect(addInterval("2026-01-31T12:00:00.000Z", "month")).toBe("2026-02-28T12:00:00.000Z");
    expect(addInterval("2028-02-29T12:00:00.000Z", "year")).toBe("2029-02-28T12:00:00.000Z");
    expect(addInterval("2026-03-15T12:00:00.000Z", "month", -3)).toBe("2025-12-15T12:00:00.000Z");
  });
});

describe("máquina de estados", () => {
  it("cubre los ocho estados con mensaje, acciones y nivel de acceso", () => {
    expect(SUBSCRIPTION_STATUSES).toHaveLength(8);
    for (const s of SUBSCRIPTION_STATUSES) {
      expect(STATUS_INFO[s].label.length).toBeGreaterThan(3);
      expect(STATUS_INFO[s].message.length).toBeGreaterThan(10);
      expect(["full", "read_only"]).toContain(STATUS_INFO[s].access);
    }
    // Nunca se pierde el acceso de consulta; durante el cobro pendiente se conserva todo.
    expect(STATUS_INFO.past_due.access).toBe("full");
    expect(STATUS_INFO.grace_period.access).toBe("full");
    expect(STATUS_INFO.unpaid.access).toBe("read_only");
  });

  it("recorre el flujo de pago rechazado → gracia → regularización", () => {
    let s = transition("incomplete", "checkout_completed");
    s = transition(s, "payment_failed");
    expect(s).toBe("past_due");
    s = transition(s, "payment_retry_failed");
    expect(s).toBe("grace_period");
    s = transition(s, "grace_period_expired");
    expect(s).toBe("unpaid");
    expect(transition(s, "payment_recovered")).toBe("active");
  });

  it("rechaza transiciones inválidas", () => {
    expect(() => transition("canceled", "renewed")).toThrow(InvalidTransitionError);
    expect(() => transition("active", "checkout_completed")).toThrow(InvalidTransitionError);
    expect(() => transition("expired", "payment_failed")).toThrow(InvalidTransitionError);
    expect(() => transition("active", "grace_period_expired")).toThrow(/no aplica/);
    expect(canTransition("unpaid", "renewed")).toBe(false);
    expect(allowedStatusPairs().has("canceled>active")).toBe(true);
    expect(allowedStatusPairs().has("canceled>past_due")).toBe(false);
  });
});

describe("límites y funciones por plan (independientes del rol)", () => {
  const entsFor = (code: string, status: "active" | "unpaid" = "active") => {
    const seed = buildBillingSeed(new Date("2026-11-24T00:00:00Z"));
    const p = seed.plans.find((x) => x.code === code)!;
    return resolveEntitlements({ subscription: { status }, plan: p, planEntitlements: seed.plan_entitlements.filter((e) => e.plan_id === p.id), enforced: true });
  };

  it("Esencial: 1 profesional; el segundo se rechaza con un mensaje claro", () => {
    const ent = entsFor("esencial");
    expect(checkLimit(ent, "professionals.max", 0).allowed).toBe(true);
    const second = checkLimit(ent, "professionals.max", 1);
    expect(second.allowed).toBe(false);
    expect(second.message).toMatch(/hasta 1 profesional activo/);
    expect(second.message).toMatch(/no se elimina nada/);
  });

  it("Profesional habilita reportes financieros; Esencial no", () => {
    expect(checkFeature(entsFor("esencial"), "reports.financial").allowed).toBe(false);
    expect(checkFeature(entsFor("profesional"), "reports.financial").allowed).toBe(true);
    expect(checkFeature(entsFor("profesional"), "reports.advanced").allowed).toBe(false);
    expect(checkFeature(entsFor("empresarial"), "areas.multiple").allowed).toBe(true);
  });

  it("sobre el límite tras bajar de plan: se informa, no se borra, y no se agregan más", () => {
    const ent = entsFor("profesional");
    const check = checkLimit(ent, "professionals.max", 7);
    expect(check).toMatchObject({ allowed: false, over: true, limit: 5, usage: 7 });
  });

  it("modo de consulta: se puede leer pero no crear", () => {
    const ent = entsFor("profesional", "unpaid");
    expect(ent.access).toBe("read_only");
    expect(checkFeature(ent, "module.agenda").allowed).toBe(true);
    expect(checkFeature(ent, "module.agenda", { write: true })).toMatchObject({ allowed: false, reason: "status" });
    expect(checkLimit(ent, "professionals.max", 0).allowed).toBe(false);
  });

  it("sin facturación habilitada (compatibilidad): nada se restringe", () => {
    expect(checkFeature(UNMANAGED, "reports.advanced", { write: true }).allowed).toBe(true);
    expect(checkLimit(UNMANAGED, "professionals.max", 500).allowed).toBe(true);
  });

  it("espacio sin suscripción con facturación habilitada: solo consulta", () => {
    const ent = noSubscription(true);
    expect(ent.access).toBe("read_only");
    expect(checkFeature(ent, "reports.financial").allowed).toBe(false);
  });
});

describe("plantillas de avisos", () => {
  it("las once plantillas generan asunto, texto y HTML con aviso de demostración", () => {
    const keys = Object.keys(NOTIFICATION_TEMPLATES) as TemplateKey[];
    expect(keys).toHaveLength(11);
    for (const k of keys) {
      const email = renderEmail(k, { organizationName: "Clínica <Demo>", contactName: "Ana", planName: "Profesional", amount: "$899.00 MXN", date: "1 de diciembre de 2026", appUrl: "http://wattalis.test" });
      expect(email.subject.length, k).toBeGreaterThan(5);
      expect(email.text).toContain("No se envió");
      expect(email.html).toContain("Clínica &lt;Demo&gt;");
      expect(email.html).not.toContain("<Demo>");
    }
  });
});
