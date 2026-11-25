import { Ban, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { MethodChips, Stat } from "@/features/cash/components/session-panels";
import { type ChargeListItem, getMyCharges } from "@/features/cash/queries";
import { formatMoney, sumMoney } from "@/lib/money";
import { getAppContext } from "@/lib/session";
import { formatLongDate, localParts, todayIn } from "@/lib/tz";

export const metadata: Metadata = { title: "Mis ventas" };

export default async function MySalesPage() {
  const ctx = await getAppContext();
  if (!ctx.can.operateCash) redirect("/inicio");
  const tz = ctx.workspace.timezone;
  const charges = await getMyCharges(ctx);
  const today = todayIn(tz);

  const byDay = new Map<string, ChargeListItem[]>();
  for (const c of charges) {
    const day = localParts(c.created_at, tz).date;
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }
  const paid = (list: ChargeListItem[]) => list.filter((c) => c.status !== "voided");
  const todayPaid = paid(byDay.get(today) ?? []);
  const todayVoided = (byDay.get(today) ?? []).length - todayPaid.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Mis ventas" description="Los cobros que tú registraste en este espacio, del más reciente al más antiguo." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Vendido hoy" value={formatMoney(sumMoney(todayPaid.map((c) => c.total)))} strong />
        <Stat label="Cobros hoy" value={String(todayPaid.length)} />
        <Stat label="Cancelados hoy" value={String(todayVoided)} />
      </div>

      {charges.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt className="size-6" aria-hidden />} title="Aún no registras ventas">
            Cuando cobres en Caja, tus cobros aparecerán aquí.
          </EmptyState>
        </Card>
      ) : (
        [...byDay].map(([day, list]) => (
          <Card key={day}>
            <CardHeader
              title={day === today ? "Hoy" : formatLongDate(day)}
              actions={<span className="tabular text-sm font-semibold">{formatMoney(sumMoney(paid(list).map((c) => c.total)))}</span>}
            />
            <ul className="divide-y divide-line">
              {list.map((c) => {
                const voided = c.status === "voided";
                return (
                  <li key={c.id}>
                    <Link href={`/ventas/cobros/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-sunken">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <span className={`font-semibold ${voided ? "text-muted line-through" : "text-ink"}`}>#{c.folio}</span>
                          <span className="tabular text-muted">{localParts(c.created_at, tz).time}</span>
                          <span className={voided ? "text-muted" : ""}>{c.contact_name ?? "Venta de mostrador"}</span>
                          {voided ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300">
                              <Ban className="size-3" aria-hidden />
                              Cancelado
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-sm text-muted">{c.summary}</p>
                      </div>
                      <MethodChips methods={c.methods} />
                      <p className={`tabular w-28 text-right font-semibold ${voided ? "text-muted line-through" : ""}`}>{formatMoney(c.total)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
      {charges.length >= 100 ? <p className="text-center text-xs text-muted">Se muestran tus últimos 100 cobros.</p> : null}
    </div>
  );
}
