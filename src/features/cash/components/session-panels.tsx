import { ArrowDownLeft, ArrowUpRight, Banknote, Ban, CreditCard, Landmark } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/layout";
import type { CashSessionTotals, PaymentMethod } from "@/lib/database.types";
import { formatMoney, PAYMENT_LABEL } from "@/lib/money";
import { localParts } from "@/lib/tz";
import type { SessionView } from "../queries";
import { VoidChargeDialog } from "./void-charge-dialog";

const METHOD_ICON = { cash: Banknote, card: CreditCard, transfer: Landmark };

export function Stat({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${strong ? "border-brand-700 bg-brand-50" : "border-line bg-surface"}`}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`tabular mt-0.5 text-xl font-semibold ${strong ? "text-brand-900" : "text-ink"}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function TotalsCards({ totals }: { totals: CashSessionTotals }) {
  const sold = totals.cash_sales + totals.card_sales + totals.transfer_sales;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Vendido" value={formatMoney(sold)} hint={`${totals.charges_count} ${totals.charges_count === 1 ? "cobro" : "cobros"}`} />
      <Stat label="Efectivo" value={formatMoney(totals.cash_sales)} />
      <Stat label="Tarjeta" value={formatMoney(totals.card_sales)} />
      <Stat label="Transferencia" value={formatMoney(totals.transfer_sales)} />
      <Stat label="Efectivo esperado en caja" value={formatMoney(totals.expected_cash)} hint="Fondo + efectivo + entradas − salidas" strong />
    </div>
  );
}

export function MethodChips({ methods }: { methods: PaymentMethod[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {methods.map((m) => {
        const Icon = METHOD_ICON[m];
        return (
          <span key={m} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-xs">
            <Icon className="size-3" aria-hidden />
            {PAYMENT_LABEL[m]}
          </span>
        );
      })}
    </span>
  );
}

export function ChargesCard({
  view,
  timezone,
  organizationId,
  canVoid,
}: {
  view: SessionView;
  timezone: string;
  organizationId: string;
  canVoid: boolean;
}) {
  const open = !view.session.closed_at;
  return (
    <Card>
      <CardHeader title="Cobros del turno" description={view.charges.length ? undefined : "Todavía no hay cobros en este turno."} />
      {view.charges.length > 0 ? (
        <ul className="divide-y divide-line">
          {view.charges.map((c) => {
            const voided = c.status === "voided";
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/ventas/cobros/${c.id}`} className={`font-semibold underline-offset-2 hover:underline ${voided ? "text-muted line-through" : "text-ink"}`}>
                      #{c.folio}
                    </Link>
                    <span className="tabular text-muted">{localParts(c.created_at, timezone).time}</span>
                    <span className={voided ? "text-muted" : ""}>{c.contact_name ?? "Venta de mostrador"}</span>
                    {voided ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300">
                        <Ban className="size-3" aria-hidden />
                        Cancelado
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted">{c.summary}</p>
                  {voided ? <p className="text-xs text-muted">Motivo: {c.void_reason}</p> : null}
                </div>
                <MethodChips methods={c.methods} />
                <p className={`tabular w-28 text-right font-semibold ${voided ? "text-muted line-through" : ""}`}>{formatMoney(c.total)}</p>
                <div className="flex w-24 justify-end">
                  {canVoid && open && !voided ? <VoidChargeDialog organizationId={organizationId} chargeId={c.id} folio={c.folio} total={c.total} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {view.totals.voided_count > 0 ? (
        <p className="border-t border-line px-5 py-2 text-xs text-muted">
          {view.totals.voided_count} {view.totals.voided_count === 1 ? "cobro cancelado" : "cobros cancelados"} por {formatMoney(view.totals.voided_total)} (no cuentan en los totales).
        </p>
      ) : null}
    </Card>
  );
}

export function MovementsCard({ view, timezone }: { view: SessionView; timezone: string }) {
  return (
    <Card>
      <CardHeader title="Entradas y salidas de efectivo" description={view.movements.length ? undefined : "No hay movimientos en este turno."} />
      {view.movements.length > 0 ? (
        <ul className="divide-y divide-line">
          {view.movements.map((m) => {
            const Icon = m.kind === "in" ? ArrowDownLeft : ArrowUpRight;
            return (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Icon className={`size-4 shrink-0 ${m.kind === "in" ? "text-emerald-700" : "text-rose-700"}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.concept}</p>
                  <p className="text-xs text-muted">
                    {m.kind === "in" ? "Entrada" : "Salida"} · {localParts(m.created_at, timezone).time}
                    {m.created_by_name ? ` · ${m.created_by_name}` : ""}
                  </p>
                </div>
                <p className="tabular font-semibold">
                  {m.kind === "in" ? "+" : "−"}
                  {formatMoney(m.amount)}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
