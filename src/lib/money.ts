// Dinero en pesos mexicanos. Los importes viajan como números con dos decimales;
// toda aritmética se hace en centavos enteros para evitar errores de punto flotante.
import type { PaymentMethod } from "@/lib/database.types";

export const CURRENCY = "MXN";
export const MAX_AMOUNT = 9_999_999.99;

const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: CURRENCY });

export function formatMoney(amount: number | null | undefined): string {
  return formatter.format(amount ?? 0);
}

/** Pesos → centavos enteros. */
export const toCents = (amount: number) => Math.round(amount * 100);
/** Centavos → pesos con dos decimales exactos. */
export const fromCents = (cents: number) => Math.round(cents) / 100;
export const sumMoney = (amounts: number[]) => fromCents(amounts.reduce((total, a) => total + toCents(a), 0));

/**
 * Lee lo que escribe una persona ("1,250.50", "$300", "12."). Devuelve null si no es un
 * importe válido con a lo más dos decimales.
 */
export function parseMoney(input: string): number | null {
  const clean = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value <= MAX_AMOUNT ? fromCents(toCents(value)) : null;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};
export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "transfer"];

export type DraftLine = { quantity: number; unitPrice: number };

/** Subtotal, descuento y total de un cobro (el servidor vuelve a calcularlo). */
export function chargeTotals(lines: DraftLine[], discount: number) {
  const subtotal = sumMoney(lines.map((l) => fromCents(toCents(l.unitPrice) * l.quantity)));
  const total = fromCents(toCents(subtotal) - toCents(discount));
  return { subtotal, discount, total };
}

/**
 * Reparte lo cobrado entre las formas de pago. Lo que excede el total en efectivo es
 * cambio para el cliente: no entra a caja. Devuelve lo pendiente y el cambio.
 */
export function settle(total: number, payments: { method: PaymentMethod; amount: number }[]) {
  const paid = payments.reduce((n, p) => n + toCents(p.amount), 0);
  const cash = payments.filter((p) => p.method === "cash").reduce((n, p) => n + toCents(p.amount), 0);
  const due = toCents(total) - paid;
  // Solo el efectivo puede dar cambio; tarjeta y transferencia deben ser exactas.
  const change = due < 0 ? Math.min(-due, cash) : 0;
  return { due: Math.max(due, 0) / 100, change: change / 100, exact: due + change === 0 };
}

/** Pagos tal como se guardan: el efectivo se descuenta del cambio entregado. */
export function netPayments<T extends { method: PaymentMethod; amount: number }>(total: number, payments: T[]): T[] {
  let change = toCents(settle(total, payments).change);
  return payments
    .map((p) => {
      if (p.method !== "cash" || change === 0) return p;
      const take = Math.min(change, toCents(p.amount));
      change -= take;
      return { ...p, amount: fromCents(toCents(p.amount) - take) };
    })
    .filter((p) => p.amount > 0);
}
