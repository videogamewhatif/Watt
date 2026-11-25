import { History, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { CloseSessionDialog } from "@/features/cash/components/close-session-dialog";
import { MovementDialog } from "@/features/cash/components/movement-dialog";
import { OpenSessionForm } from "@/features/cash/components/open-session-form";
import { PointOfSale } from "@/features/cash/components/point-of-sale";
import { ChargesCard, MovementsCard, TotalsCards } from "@/features/cash/components/session-panels";
import { getOpenSession, getPosServices, getReceivables, getRecentSessions, loadSession } from "@/features/cash/queries";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/lib/session";
import { formatInstant, formatLongDate, todayIn } from "@/lib/tz";

export const metadata: Metadata = { title: "Caja" };

export default async function CashPage() {
  const ctx = await getAppContext();
  if (!ctx.can.operateCash) redirect("/inicio");
  const tz = ctx.workspace.timezone;
  const open = await getOpenSession(ctx);

  if (!open) {
    const recent = await getRecentSessions(ctx);
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title="Caja" description="Abre un turno para cobrar. Al terminar, el corte compara el efectivo contado contra el esperado." />
        <Card>
          <CardHeader title="La caja está cerrada" description="Cuenta el efectivo con el que empiezas y ábrela para registrar cobros." />
          <div className="px-5 py-5">
            <OpenSessionForm organizationId={ctx.workspace.id} />
          </div>
        </Card>
        <SessionHistory sessions={recent} timezone={tz} />
      </div>
    );
  }

  const [view, services, receivables, recent] = await Promise.all([loadSession(ctx, open), getPosServices(ctx), getReceivables(ctx), getRecentSessions(ctx, 5)]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Caja"
        actions={
          <>
            <MovementDialog organizationId={ctx.workspace.id} />
            <CloseSessionDialog
              organizationId={ctx.workspace.id}
              sessionId={open.id}
              expectedCash={view.totals.expected_cash}
              summary={{ opening: open.opening_amount, cashSales: view.totals.cash_sales, movementsIn: view.totals.movements_in, movementsOut: view.totals.movements_out }}
            />
          </>
        }
      />
      <PointOfSale
        organizationId={ctx.workspace.id}
        services={services}
        receivables={receivables}
        dateLabel={formatLongDate(todayIn(tz))}
        sessionLabel={`Turno abierto ${formatInstant(open.opened_at, tz)}${view.openedByName ? ` por ${view.openedByName}` : ""} · Fondo inicial ${formatMoney(open.opening_amount)}`}
      />
      <TotalsCards totals={view.totals} />
      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <ChargesCard view={view} timezone={tz} organizationId={ctx.workspace.id} canVoid={ctx.can.voidCharges} />
        <MovementsCard view={view} timezone={tz} />
      </div>
      <SessionHistory sessions={recent} timezone={tz} compact />
    </div>
  );
}

function SessionHistory({ sessions, timezone, compact = false }: { sessions: Awaited<ReturnType<typeof getRecentSessions>>; timezone: string; compact?: boolean }) {
  if (sessions.length === 0) {
    return compact ? null : (
      <Card>
        <EmptyState icon={<Wallet className="size-6" aria-hidden />} title="Aún no hay cortes">
          Cuando cierres tu primer turno, aparecerá aquí con su diferencia.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Cortes recientes" actions={<History className="size-4 text-muted" aria-hidden />} />
      <ul className="divide-y divide-line">
        {sessions.map((s) => {
          const diff = s.difference ?? 0;
          return (
            <li key={s.id}>
              <Link href={`/ventas/turnos/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-sunken">
                <span className="min-w-0 flex-1 font-medium">{formatInstant(s.closed_at ?? s.opened_at, timezone)}</span>
                <span className="tabular text-muted">Esperado {formatMoney(s.expected_cash)}</span>
                <span className="tabular text-muted">Contado {formatMoney(s.counted_cash)}</span>
                <span className={`tabular w-36 text-right font-semibold ${diff === 0 ? "text-emerald-800" : "text-amber-900"}`}>
                  {diff === 0 ? "Sin diferencia" : `${diff > 0 ? "Sobran" : "Faltan"} ${formatMoney(Math.abs(diff))}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
