// Permisos comerciales (entitlements): qué incluye el plan del espacio.
// Son independientes de los roles: un rol dice QUIÉN puede hacer algo; el plan
// dice SI el espacio lo tiene contratado. Una acción necesita ambos.
import { type BooleanFeatureCode, FEATURE_BY_CODE, type FeatureCode, FEATURES, type LimitCode } from "./catalog";
import { type AccessLevel, STATUS_INFO } from "./state-machine";
import type { PlanEntitlementRow, PlanRow, SubscriptionRow, SubscriptionStatus } from "./types";

export type Entitlements = {
  /**
   * - unmanaged: la facturación no está habilitada (sin restricciones, compatible
   *   con espacios existentes).
   * - none: facturación habilitada pero el espacio no tiene suscripción.
   */
  status: SubscriptionStatus | "none" | "unmanaged";
  access: AccessLevel;
  plan: Pick<PlanRow, "id" | "code" | "name" | "tier"> | null;
  features: Record<BooleanFeatureCode, boolean>;
  /** null = sin límite. */
  limits: Record<LimitCode, number | null>;
  /** Si es false, los límites se muestran pero no bloquean. */
  enforced: boolean;
};

const BOOLEAN_CODES = FEATURES.filter((f) => f.kind === "feature").map((f) => f.code) as BooleanFeatureCode[];
const LIMIT_CODES = FEATURES.filter((f) => f.kind === "limit").map((f) => f.code) as LimitCode[];

function featureMap(value: (code: BooleanFeatureCode) => boolean) {
  return Object.fromEntries(BOOLEAN_CODES.map((c) => [c, value(c)])) as Record<BooleanFeatureCode, boolean>;
}
function limitMap(value: (code: LimitCode) => number | null) {
  return Object.fromEntries(LIMIT_CODES.map((c) => [c, value(c)])) as Record<LimitCode, number | null>;
}

/** Sin facturación habilitada: todo permitido (los espacios actuales siguen igual). */
export const UNMANAGED: Entitlements = {
  status: "unmanaged",
  access: "full",
  plan: null,
  features: featureMap(() => true),
  limits: limitMap(() => null),
  enforced: false,
};

/** Espacio sin suscripción con facturación habilitada: solo el núcleo y en consulta. */
export function noSubscription(enforced: boolean): Entitlements {
  return {
    status: "none",
    access: "read_only",
    plan: null,
    features: featureMap((c) => c.startsWith("module.") || c === "reports.basic" || c === "activity.history"),
    limits: limitMap(() => 0),
    enforced,
  };
}

export function resolveEntitlements(input: {
  subscription: Pick<SubscriptionRow, "status"> | null;
  plan: Pick<PlanRow, "id" | "code" | "name" | "tier"> | null;
  planEntitlements: Pick<PlanEntitlementRow, "feature_code" | "enabled" | "usage_limit">[];
  enforced: boolean;
}): Entitlements {
  const { subscription, plan } = input;
  if (!subscription || !plan) return noSubscription(input.enforced);
  const byCode = new Map(input.planEntitlements.map((e) => [e.feature_code, e]));
  return {
    status: subscription.status,
    access: STATUS_INFO[subscription.status].access,
    plan: { id: plan.id, code: plan.code, name: plan.name, tier: plan.tier },
    features: featureMap((c) => byCode.get(c)?.enabled === true),
    limits: limitMap((c) => {
      const e = byCode.get(c);
      if (!e || !e.enabled) return 0;
      return e.usage_limit;
    }),
    enforced: input.enforced,
  };
}

export type FeatureCheck =
  | { allowed: true }
  | { allowed: false; reason: "plan" | "status"; message: string };

/** ¿El espacio puede usar la función? Considera el plan y el estado (modo de consulta). */
export function checkFeature(ent: Entitlements, code: BooleanFeatureCode, { write = false }: { write?: boolean } = {}): FeatureCheck {
  if (ent.status === "unmanaged") return { allowed: true };
  if (!ent.features[code]) {
    if (!ent.enforced) return { allowed: true };
    return {
      allowed: false,
      reason: "plan",
      message: `${ent.plan ? `El plan ${ent.plan.name}` : "Tu plan actual"} no incluye «${FEATURE_BY_CODE[code]?.label ?? code}». Cambia de plan para habilitar esta función.`,
    };
  }
  if (write && ent.access === "read_only") return { allowed: false, reason: "status", message: readOnlyMessage(ent) };
  return { allowed: true };
}

export type LimitCheck = {
  allowed: boolean;
  limit: number | null;
  usage: number;
  /** Uso por encima del límite (p. ej. tras bajar de plan). */
  over: boolean;
  message?: string;
};

const LIMIT_NOUN: Record<LimitCode, [string, string]> = {
  "professionals.max": ["profesional activo", "profesionales activos"],
  "users.max": ["usuario interno", "usuarios internos"],
  "workspaces.max": ["espacio de trabajo", "espacios de trabajo"],
};

export function limitNoun(code: LimitCode, n: number) {
  return LIMIT_NOUN[code][n === 1 ? 0 : 1];
}

/** ¿Cabe `adding` más? Nunca obliga a borrar lo existente aunque se esté por encima. */
export function checkLimit(ent: Entitlements, code: LimitCode, usage: number, adding = 1): LimitCheck {
  const limit = ent.limits[code];
  const over = limit !== null && usage > limit;
  if (ent.status === "unmanaged" || limit === null) return { allowed: true, limit, usage, over: false };
  if (ent.access === "read_only" && ent.enforced) return { allowed: false, limit, usage, over, message: readOnlyMessage(ent) };
  if (usage + adding <= limit || !ent.enforced) return { allowed: true, limit, usage, over };
  return {
    allowed: false,
    limit,
    usage,
    over,
    message: `${ent.plan ? `El plan ${ent.plan.name}` : "Tu plan"} incluye hasta ${limit} ${limitNoun(code, limit)} y ya tienes ${usage}. Cambia a un plan superior para agregar más; no se elimina nada de lo que ya existe.`,
  };
}

export function readOnlyMessage(ent: Entitlements): string {
  if (ent.status === "none") return "Este espacio no tiene un plan activo. Puedes consultar y exportar tu información; contrata un plan para volver a registrar citas, profesionales o usuarios.";
  if (ent.status === "unmanaged") return "";
  return `${STATUS_INFO[ent.status].label}: el espacio está en modo de consulta. Puedes ver y exportar tu información; no se ha borrado nada.`;
}

/** Funciones que se pierden al pasar de un plan a otro (para avisos de reducción). */
export function lostFeatures(from: Pick<PlanEntitlementRow, "feature_code" | "enabled">[], to: Pick<PlanEntitlementRow, "feature_code" | "enabled">[]): FeatureCode[] {
  const toEnabled = new Set(to.filter((e) => e.enabled).map((e) => e.feature_code));
  return from
    .filter((e) => e.enabled && !toEnabled.has(e.feature_code) && FEATURE_BY_CODE[e.feature_code]?.kind === "feature")
    .map((e) => e.feature_code as FeatureCode);
}

export function gainedFeatures(from: Pick<PlanEntitlementRow, "feature_code" | "enabled">[], to: Pick<PlanEntitlementRow, "feature_code" | "enabled">[]): FeatureCode[] {
  return lostFeatures(to, from);
}
