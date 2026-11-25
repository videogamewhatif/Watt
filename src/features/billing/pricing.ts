// Cálculo de importes. Todo en centavos enteros: nunca se suman pesos con
// decimales en punto flotante. Las tasas van en puntos base (1600 = 16 %).
import type { BillingInterval, BillingSettingsRow, PlanRow } from "./types";

const BPS = 10_000;

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const moneyRound = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

/** $1,234.50 (o $1,234 si no hay centavos y `compact`). */
export function formatCents(cents: number, { compact = false }: { compact?: boolean } = {}): string {
  if (compact && cents % 100 === 0) return moneyRound.format(cents / 100);
  return money.format(cents / 100);
}

export function pct(bps: number): string {
  return `${(bps / 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })} %`;
}

/** Precio anual a partir del mensual con el descuento configurado (redondeado al centavo). */
export function annualFromMonthly(monthlyCents: number, discountBps: number): number {
  return Math.round((monthlyCents * 12 * (BPS - discountBps)) / BPS);
}

export type TaxBreakdown = { subtotalCents: number; taxCents: number; totalCents: number; taxRateBps: number; included: boolean };

/** Desglose de IVA. Con precios con IVA incluido, el total no cambia: se separa la base. */
export function taxBreakdown(amountCents: number, settings: Pick<BillingSettingsRow, "tax_rate_bps" | "prices_include_tax">): TaxBreakdown {
  const rate = settings.tax_rate_bps;
  if (settings.prices_include_tax) {
    const subtotal = Math.round((amountCents * BPS) / (BPS + rate));
    return { subtotalCents: subtotal, taxCents: amountCents - subtotal, totalCents: amountCents, taxRateBps: rate, included: true };
  }
  const tax = Math.round((amountCents * rate) / BPS);
  return { subtotalCents: amountCents, taxCents: tax, totalCents: amountCents + tax, taxRateBps: rate, included: false };
}

export type Quote = {
  interval: BillingInterval;
  /** Importe que se cobra en cada periodo (sin impuestos añadidos si no están incluidos). */
  periodPriceCents: number;
  /** Referencia mensual (anual / 12). */
  monthlyEquivalentCents: number;
  /** Mensual × 12, para comparar. */
  listAnnualCents: number;
  /** Ahorro anual frente a pagar mes a mes (0 en mensual). */
  annualSavingsCents: number;
  /** Descuento efectivo del plan anual frente al mensual, en puntos base. */
  discountBps: number;
  tax: TaxBreakdown;
};

/** Cotización de un plan. Devuelve null para planes con precio personalizado. */
export function quote(
  plan: Pick<PlanRow, "monthly_price_cents" | "annual_price_cents" | "is_custom_pricing">,
  interval: BillingInterval,
  settings: Pick<BillingSettingsRow, "tax_rate_bps" | "prices_include_tax">,
): Quote | null {
  if (plan.is_custom_pricing || plan.monthly_price_cents === null || plan.annual_price_cents === null) return null;
  const monthly = plan.monthly_price_cents;
  const annual = plan.annual_price_cents;
  const listAnnual = monthly * 12;
  const period = interval === "month" ? monthly : annual;
  return {
    interval,
    periodPriceCents: period,
    monthlyEquivalentCents: interval === "month" ? monthly : Math.round(annual / 12),
    listAnnualCents: listAnnual,
    annualSavingsCents: interval === "year" ? Math.max(listAnnual - annual, 0) : 0,
    discountBps: listAnnual > 0 ? Math.round(((listAnnual - annual) * BPS) / listAnnual) : 0,
    tax: taxBreakdown(period, settings),
  };
}

/** Ingreso recurrente mensual de una suscripción (anual / 12). */
export function monthlyRecurringCents(periodPriceCents: number, interval: BillingInterval): number {
  return interval === "month" ? periodPriceCents : Math.round(periodPriceCents / 12);
}

/** Suma un mes o un año calendario conservando el día (el 31 pasa al último día del mes). */
export function addInterval(iso: string, interval: BillingInterval, count = 1): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const target = new Date(d);
  target.setUTCDate(1);
  if (interval === "month") target.setUTCMonth(target.getUTCMonth() + count);
  else target.setUTCFullYear(target.getUTCFullYear() + count);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export type Proration = {
  /** Parte no usada del periodo actual que se acredita. */
  creditCents: number;
  /** Lo que cuesta el nuevo plan por el tiempo restante (o el periodo completo si cambia la periodicidad). */
  chargeCents: number;
  /** Importe a cobrar hoy (nunca negativo: un saldo a favor se aplicaría en la siguiente factura). */
  amountDueCents: number;
  /** Fracción restante del periodo actual, 0…1. */
  remainingFraction: number;
  /** Si cambia la periodicidad, el nuevo periodo empieza hoy. */
  restartsPeriod: boolean;
};

/**
 * Estimación de prorrateo para una mejora inmediata. En producción la cifra
 * definitiva la calcula la pasarela (p. ej. vista previa de factura de Stripe);
 * esta función da la misma lógica para la demostración y para mostrar el resumen.
 */
export function prorate(input: {
  currentPriceCents: number;
  newPriceCents: number;
  periodStart: string;
  periodEnd: string;
  now: string;
  intervalChanges: boolean;
}): Proration {
  const start = new Date(input.periodStart).getTime();
  const end = new Date(input.periodEnd).getTime();
  const now = Math.min(Math.max(new Date(input.now).getTime(), start), end);
  const total = Math.max(end - start, 1);
  const remainingFraction = (end - now) / total;
  const credit = Math.round(input.currentPriceCents * remainingFraction);
  const charge = input.intervalChanges ? input.newPriceCents : Math.round(input.newPriceCents * remainingFraction);
  return {
    creditCents: credit,
    chargeCents: charge,
    amountDueCents: Math.max(charge - credit, 0),
    remainingFraction,
    restartsPeriod: input.intervalChanges,
  };
}

export const INTERVAL_LABEL: Record<BillingInterval, string> = { month: "Mensual", year: "Anual" };
export const INTERVAL_UNIT: Record<BillingInterval, string> = { month: "mes", year: "año" };
