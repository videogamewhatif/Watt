import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { ChargesCard, MovementsCard, Stat, TotalsCards } from "@/features/cash/components/session-panels";
import { getSession, loadSession } from "@/features/cash/queries";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/lib/session";
import { formatInstant } from "@/lib/tz";

export const metadata: Metadata = { title: "Corte de caja" };

export default async function SessionPage({ params }: PageProps<"/ventas/turnos/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getAppContext();
  if (!ctx.can.operateCash) redirect("/inicio");
  const session = await getSession(ctx, id);
  if (!session) notFound();
  if (!session.closed_at) redirect("/ventas/caja");
  const tz = ctx.workspace.timezone;
  const view = await loadSession(ctx, session);
  const diff = session.difference ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Corte de caja"
        description={`${formatInstant(session.opened_at, tz)} → ${formatInstant(session.closed_at, tz)}`}
        actions={
          <LinkButton variant="secondary" href="/ventas/caja">
            Volver a Caja
          </LinkButton>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fondo inicial" value={formatMoney(session.opening_amount)} hint={view.openedByName ? `Abrió ${view.openedByName}` : undefined} />
        <Stat label="Efectivo esperado" value={formatMoney(session.expected_cash)} />
        <Stat label="Efectivo contado" value={formatMoney(session.counted_cash)} hint={view.closedByName ? `Cerró ${view.closedByName}` : undefined} />
        <Stat label="Diferencia" value={diff === 0 ? "Sin diferencia" : `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))}`} strong={diff === 0} />
      </div>
      {session.closing_notes ? (
        <Alert tone={diff === 0 ? "info" : "warning"} title="Nota del corte">
          {session.closing_notes}
        </Alert>
      ) : null}
      <TotalsCards totals={view.totals} />
      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <ChargesCard view={view} timezone={tz} organizationId={ctx.workspace.id} canVoid={false} />
        <MovementsCard view={view} timezone={tz} />
      </div>
    </div>
  );
}
