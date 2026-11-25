// Catálogo inicial de planes y funciones. Son valores ILUSTRATIVOS de arranque:
// se copian al almacén (demostración) o a la base (migración) y desde ahí se
// editan en /admin/suscripciones. La aplicación nunca lee precios de este archivo
// cuando hay un catálogo configurado.
import type { BillingSettingsRow } from "./types";

export type FeatureKind = "limit" | "feature";
export type FeatureGroup = "capacidad" | "operacion" | "reportes" | "automatizacion" | "empresa";

export type FeatureDef = {
  code: string;
  label: string;
  kind: FeatureKind;
  group: FeatureGroup;
  /** Explicación breve para la tabla comparativa. */
  hint?: string;
  /** Aún no existe en el producto: se muestra como «Próximamente» y no se vende como disponible. */
  soon?: boolean;
};

export const FEATURE_GROUPS: { key: FeatureGroup; label: string }[] = [
  { key: "capacidad", label: "Capacidad" },
  { key: "operacion", label: "Operación diaria" },
  { key: "reportes", label: "Reportes" },
  { key: "automatizacion", label: "Automatización" },
  { key: "empresa", label: "Administración empresarial" },
];

export const FEATURES = [
  { code: "professionals.max", label: "Profesionales", kind: "limit", group: "capacidad", hint: "Perfiles profesionales activos que reciben citas." },
  { code: "users.max", label: "Usuarios internos", kind: "limit", group: "capacidad", hint: "Cuentas de administración, recepción y profesionales." },
  { code: "workspaces.max", label: "Espacios de trabajo", kind: "limit", group: "capacidad", hint: "Sedes o clínicas con información independiente." },
  { code: "module.agenda", label: "Agenda de citas", kind: "feature", group: "operacion" },
  { code: "module.patients", label: "Gestión de pacientes", kind: "feature", group: "operacion" },
  { code: "module.services", label: "Servicios y precios", kind: "feature", group: "operacion" },
  { code: "module.cash", label: "Control de cobros (caja)", kind: "feature", group: "operacion" },
  { code: "module.schedules", label: "Horarios y bloqueos", kind: "feature", group: "operacion" },
  { code: "activity.history", label: "Historial de cambios de cada cita", kind: "feature", group: "operacion" },
  { code: "areas.multiple", label: "Gestión de diferentes áreas médicas", kind: "feature", group: "operacion", hint: "Filtra agenda y profesionales por área (medicina, odontología, nutrición…)." },
  { code: "reports.basic", label: "Reportes básicos", kind: "feature", group: "reportes", hint: "Citas, citas atendidas sin cobro y actividad propia." },
  { code: "reports.financial", label: "Reportes financieros", kind: "feature", group: "reportes", hint: "Ventas, ingresos por concepto y cortes de caja." },
  { code: "reports.advanced", label: "Reportes avanzados", kind: "feature", group: "reportes", hint: "Desempeño por profesional y análisis de pacientes." },
  { code: "admin.advanced", label: "Auditoría de cancelaciones y descuentos", kind: "feature", group: "reportes" },
  { code: "reminders.automatic", label: "Recordatorios automáticos", kind: "feature", group: "automatizacion", soon: true },
  { code: "automations", label: "Automatizaciones", kind: "feature", group: "automatizacion", soon: true },
  { code: "support.priority", label: "Soporte prioritario", kind: "feature", group: "empresa", soon: true },
  { code: "billing.central", label: "Facturación centralizada de varias sedes", kind: "feature", group: "empresa" },
  { code: "admin.enterprise", label: "Administración empresarial", kind: "feature", group: "empresa" },
  { code: "api.access", label: "Integraciones por API", kind: "feature", group: "empresa", soon: true },
] as const satisfies readonly FeatureDef[];

export type FeatureCode = (typeof FEATURES)[number]["code"];
export type LimitCode = Extract<(typeof FEATURES)[number], { kind: "limit" }>["code"];
export type BooleanFeatureCode = Exclude<FeatureCode, LimitCode>;

export const FEATURE_BY_CODE: Record<string, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.code, f]));

export function isFeatureCode(value: string): value is FeatureCode {
  return value in FEATURE_BY_CODE;
}

/** Funciones incluidas en todos los planes (el núcleo operativo nunca se bloquea por plan). */
export const CORE_FEATURES: BooleanFeatureCode[] = [
  "module.agenda",
  "module.patients",
  "module.services",
  "module.cash",
  "module.schedules",
  "activity.history",
  "reports.basic",
];

export type PlanSeed = {
  code: string;
  name: string;
  description: string;
  monthly_price_cents: number | null;
  badge: string | null;
  tier: number;
  limits: Record<LimitCode, number | null>;
  features: BooleanFeatureCode[];
};

export const DEFAULT_SETTINGS: Omit<BillingSettingsRow, "updated_at" | "updated_by"> = {
  annual_discount_bps: 1500,
  grace_period_days: 7,
  tax_rate_bps: 1600,
  prices_include_tax: true,
  trial_days: 14,
  enforce_limits: true,
};

export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: "esencial",
    name: "Esencial",
    description: "Para profesionales independientes.",
    monthly_price_cents: 39_900,
    badge: null,
    tier: 1,
    limits: { "professionals.max": 1, "users.max": 2, "workspaces.max": 1 },
    features: [...CORE_FEATURES],
  },
  {
    code: "profesional",
    name: "Profesional",
    description: "Para clínicas pequeñas.",
    monthly_price_cents: 89_900,
    badge: "Más popular",
    tier: 2,
    limits: { "professionals.max": 5, "users.max": 10, "workspaces.max": 1 },
    features: [...CORE_FEATURES, "reports.financial", "reminders.automatic"],
  },
  {
    code: "empresarial",
    name: "Empresarial",
    description: "Para clínicas y centros médicos grandes.",
    monthly_price_cents: 199_900,
    badge: null,
    tier: 3,
    limits: { "professionals.max": 20, "users.max": 50, "workspaces.max": 1 },
    features: [...CORE_FEATURES, "reports.financial", "reports.advanced", "admin.advanced", "areas.multiple", "reminders.automatic", "automations", "support.priority"],
  },
  {
    code: "corporativo",
    name: "Corporativo",
    description: "Para hospitales y grupos médicos.",
    monthly_price_cents: null,
    badge: null,
    tier: 4,
    limits: { "professionals.max": null, "users.max": null, "workspaces.max": null },
    features: [
      ...CORE_FEATURES,
      "reports.financial",
      "reports.advanced",
      "admin.advanced",
      "areas.multiple",
      "reminders.automatic",
      "automations",
      "support.priority",
      "billing.central",
      "admin.enterprise",
      "api.access",
    ],
  },
];

/** Preguntas frecuentes de /precios (la de impuestos depende de la configuración vigente). */
export function pricingFaq(settings: Pick<BillingSettingsRow, "prices_include_tax" | "tax_rate_bps" | "grace_period_days">): { q: string; a: string }[] {
  const rate = `${settings.tax_rate_bps / 100} %`;
  return PRICING_FAQ.map((item) => {
    if (item.q.startsWith("¿Los precios incluyen"))
      return {
        q: item.q,
        a: settings.prices_include_tax
          ? `Sí, los precios mostrados incluyen IVA (${rate}). El desglose aparece en el resumen antes de confirmar.`
          : `No, al precio mostrado se suma el IVA (${rate}). El desglose aparece en el resumen antes de confirmar.`,
      };
    if (item.q.startsWith("¿Qué pasa si un pago"))
      return { q: item.q, a: item.a.replace("un periodo de gracia", `un periodo de gracia de ${settings.grace_period_days} días`) };
    return item;
  });
}

const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: "¿Puedo cambiar de plan después?",
    a: "Sí. Una mejora se aplica de inmediato y solo pagas la diferencia proporcional del periodo. Una reducción se programa para el final del periodo que ya pagaste.",
  },
  {
    q: "¿Qué pasa con mi información si cancelo?",
    a: "Conservas el acceso hasta el final del periodo pagado. Después tu espacio queda en modo de consulta: nada se borra (pacientes, citas, cobros ni usuarios) y puedes reactivar tu plan cuando quieras.",
  },
  {
    q: "¿Cómo funciona la facturación anual?",
    a: "Pagas los 12 meses en un solo cargo al año con un descuento sobre el precio mensual. El precio equivalente por mes es solo una referencia: el cargo real es anual.",
  },
  {
    q: "¿Qué pasa si un pago no se procesa?",
    a: "Te avisamos y reintentamos el cobro. Mantienes el acceso completo durante un periodo de gracia para actualizar tu método de pago; si el pago no se regulariza, el espacio pasa a modo de consulta sin perder información.",
  },
  {
    q: "¿Los precios incluyen impuestos?",
    a: "Los precios mostrados incluyen IVA. El desglose aparece en el resumen antes de confirmar.",
  },
  {
    q: "¿Emiten factura (CFDI)?",
    a: "La facturación electrónica se habilitará con un proveedor autorizado. Mientras tanto, los comprobantes que ves en esta demostración no tienen validez fiscal.",
  },
];
