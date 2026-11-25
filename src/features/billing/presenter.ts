// Textos derivados del catálogo configurado (no de constantes): si la plataforma
// cambia límites o funciones, la página de precios y los resúmenes cambian solos.
import { CORE_FEATURES, FEATURE_BY_CODE, FEATURES, type LimitCode } from "./catalog";
import type { PlanEntitlementRow, PlanRow } from "./types";

type Ent = Pick<PlanEntitlementRow, "plan_id" | "feature_code" | "enabled" | "usage_limit">;

export function limitText(code: LimitCode, limit: number | null | undefined): string | null {
  if (limit === undefined) return null;
  switch (code) {
    case "professionals.max":
      return limit === null ? "Profesionales según tu operación" : limit === 1 ? "1 profesional" : `Hasta ${limit} profesionales`;
    case "users.max":
      return limit === null ? "Usuarios internos a la medida" : limit === 1 ? "1 usuario interno" : `${limit <= 2 ? "" : "Hasta "}${limit} usuarios internos`;
    case "workspaces.max":
      return limit === null ? "Múltiples espacios de trabajo" : limit === 1 ? null : `Hasta ${limit} espacios de trabajo`;
  }
}

export function featureLabel(code: string): string {
  const def = FEATURE_BY_CODE[code];
  if (!def) return code;
  return def.soon ? `${def.label} (próximamente)` : def.label;
}

/** Beneficios de la tarjeta: los límites y lo que agrega frente al plan anterior. */
export function planHighlights(plan: PlanRow, entitlements: Ent[], previous: PlanRow | null): { intro: string | null; items: string[] } {
  const own = entitlements.filter((e) => e.plan_id === plan.id && e.enabled);
  const prev = previous ? entitlements.filter((e) => e.plan_id === previous.id && e.enabled) : [];
  const limits = FEATURES.filter((f) => f.kind === "limit")
    .map((f) => limitText(f.code as LimitCode, own.find((e) => e.feature_code === f.code)?.usage_limit))
    .filter((t): t is string => Boolean(t));
  const prevCodes = new Set(prev.map((e) => e.feature_code));
  const features = FEATURES.filter((f) => f.kind === "feature" && own.some((e) => e.feature_code === f.code))
    .filter((f) => (previous ? !prevCodes.has(f.code) : true))
    .sort((a, b) => Number(Boolean("soon" in a && a.soon)) - Number(Boolean("soon" in b && b.soon)))
    .map((f) => featureLabel(f.code));
  const items = [...limits, ...features];
  if (plan.is_custom_pricing) items.push("Condiciones comerciales particulares");
  return { intro: previous ? `Todo lo del plan ${previous.name}, más:` : null, items };
}

export function isCore(code: string) {
  return (CORE_FEATURES as string[]).includes(code);
}

/** Valor de una celda de la tabla comparativa. */
export function comparisonCell(planId: string, code: string, entitlements: Ent[]): { included: boolean; text: string | null } {
  const def = FEATURE_BY_CODE[code];
  const e = entitlements.find((x) => x.plan_id === planId && x.feature_code === code);
  if (def?.kind === "limit") {
    if (!e || !e.enabled) return { included: false, text: null };
    return { included: true, text: e.usage_limit === null ? "A la medida" : String(e.usage_limit) };
  }
  return { included: Boolean(e?.enabled), text: null };
}

export const PERIOD_PARAM = { month: "mensual", year: "anual" } as const;

export function intervalFromParam(value: unknown) {
  return value === "anual" || value === "year" ? ("year" as const) : ("month" as const);
}
