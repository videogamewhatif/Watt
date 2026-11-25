import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { PreCount } from "@/features/cash/components/pre-count";
import { PrintButton } from "@/features/cash/components/print-button";
import { MovementsCard, TotalsCards } from "@/features/cash/components/session-panels";
import { getOpenSession, loadSession } from "@/features/cash/queries";
import { formatMoney, sumMoney } from "@/lib/money";
import { getAppContext } from "@/lib/session";
import { formatInstant } from "@/lib/tz";

export const metadata: Metadata = { title: "Precorte" };

export default async function PreClosePage() {
  const ctx = await getAppContext();
  if (!ctx.can.operateCash) redirect("/inicio");
  const tz = ctx.workspace.timezone;
  const open = await getOpenSession(ctx);

  if (!open) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title="Precorte" description="Revisa cómo va el turno sin cerrarlo." />
        <Card>
          <EmptyState
            icon={<Wallet className="size-6" aria-hidden />}
            title="No hay un turno abierto"
            action={<LinkButton href="/ventas/caja">Ir a Caja</LinkButton>}
          >
            El precorte se hace sobre el turno de caja abierto.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const view = await loadSession(ctx, open);
  const t = view.totals;

  // Ventas vigentes por persona que cobró.
  const byCashier = new Map<string, { count: number; totals: number[] }>();
  for (const c of view.charges) {
    if (c.status === "voided") continue;
    const key = c.created_by_name ?? "Sin nombre";
    const entry = byCashier.get(key) ?? { count: 0, totals: [] };
    entry.count += 1;
    entry.totals.push(c.total);
    byCashier.set(key, entry);
  }

  const row = (label: string, amount: number, sign = "") => (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>
        {sign}
        {formatMoney(amount)}
      </dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Precorte"
        description={`Al ${formatInstant(new Date(), tz)} · Turno abierto ${formatInstant(open.opened_at, tz)}${view.openedByName ? ` por ${view.openedByName}` : ""}`}
        actions={
          <span className="print:hidden">
            <PrintButton />
          </span>
        }
      />
      <TotalsCards totals={t} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Efectivo en caja" description="Lo que debería haber en este momento." />
          <div className="space-y-5 px-5 py-4">
            <dl className="tabular space-y-1 text-sm">
              {row("Fondo inicial", t.opening_amount)}
              {row("Cobros en efectivo", t.cash_sales, "+")}
              {row("Entradas", t.movements_in, "+")}
              {row("Salidas", t.movements_out, "−")}
              <div className="flex justify-between gap-4 border-t border-line-strong pt-1 font-semibold">
                <dt>Efectivo esperado</dt>
                <dd>{formatMoney(t.expected_cash)}</dd>
              </div>
            </dl>
            <div className="print:hidden">
              <PreCount expectedCash={t.expected_cash} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Ventas por cajero" description={byCashier.size ? undefined : "Todavía no hay cobros en este turno."} />
          {byCashier.size > 0 ? (
            <ul className="divide-y divide-line">
              {[...byCashier].map(([name, e]) => (
                <li key={name} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                  <span className="text-muted">
                    {e.count} {e.count === 1 ? "cobro" : "cobros"}
                  </span>
                  <span className="tabular w-28 text-right font-semibold">{formatMoney(sumMoney(e.totals))}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {t.voided_count > 0 ? (
            <p className="border-t border-line px-5 py-2 text-xs text-muted">
              {t.voided_count} {t.voided_count === 1 ? "cobro cancelado" : "cobros cancelados"} por {formatMoney(t.voided_total)} (no cuentan).
            </p>
          ) : null}
        </Card>
      </div>

      <MovementsCard view={view} timezone={tz} />
    </div>
  );
}
