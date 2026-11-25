// Cálculo de totales de un turno de caja en el modo de prueba. Equivale a la
// función SQL public.cash_session_totals (misma regla: solo cuentan cobros vigentes).
import type { CashSessionTotals } from "@/lib/database.types";
import { fromCents, toCents } from "@/lib/money";
import type { DemoStore } from "./data";

export function sessionTotals(db: Pick<DemoStore, "cash_sessions" | "charges" | "payments" | "cash_movements">, sessionId: string): CashSessionTotals | null {
  const session = db.cash_sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const charges = db.charges.filter((c) => c.session_id === sessionId);
  const paid = new Set(charges.filter((c) => c.status === "paid").map((c) => c.id));
  const sales = (method: string) =>
    db.payments.filter((p) => p.session_id === sessionId && paid.has(p.charge_id) && p.method === method).reduce((n, p) => n + toCents(p.amount), 0);
  const moved = (kind: string) => db.cash_movements.filter((m) => m.session_id === sessionId && m.kind === kind).reduce((n, m) => n + toCents(m.amount), 0);
  const voided = charges.filter((c) => c.status === "voided");
  const cash = sales("cash");
  return {
    opening_amount: session.opening_amount,
    cash_sales: fromCents(cash),
    card_sales: fromCents(sales("card")),
    transfer_sales: fromCents(sales("transfer")),
    movements_in: fromCents(moved("in")),
    movements_out: fromCents(moved("out")),
    expected_cash: fromCents(toCents(session.opening_amount) + cash + moved("in") - moved("out")),
    charges_count: paid.size,
    voided_count: voided.length,
    voided_total: fromCents(voided.reduce((n, c) => n + toCents(c.total), 0)),
  };
}
