import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PrintButton } from "@/features/cash/components/print-button";
import { VoidChargeDialog } from "@/features/cash/components/void-charge-dialog";
import { getChargeDetail } from "@/features/cash/queries";
import { formatMoney, PAYMENT_LABEL } from "@/lib/money";
import { getAppContext } from "@/lib/session";
import { formatInstant } from "@/lib/tz";

export const metadata: Metadata = { title: "Comprobante de cobro" };

export default async function ChargePage({ params }: PageProps<"/ventas/cobros/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getAppContext();
  if (!ctx.can.operateCash) redirect("/inicio");
  const detail = await getChargeDetail(ctx, id);
  if (!detail) notFound();
  const { charge, items, payments } = detail;
  const voided = charge.status === "voided";
  const tz = ctx.workspace.timezone;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <LinkButton variant="ghost" href="/ventas/caja">
          ← Caja
        </LinkButton>
        <div className="flex gap-2">
          {ctx.can.voidCharges && !voided && !detail.sessionClosed ? <VoidChargeDialog organizationId={ctx.workspace.id} chargeId={charge.id} folio={charge.folio} total={charge.total} /> : null}
          <PrintButton />
        </div>
      </div>

      {voided ? (
        <Alert tone="warning" title="Cobro cancelado">
          {formatInstant(charge.voided_at!, tz)}
          {detail.voidedByName ? ` por ${detail.voidedByName}` : ""}. Motivo: {charge.void_reason}
        </Alert>
      ) : null}

      <article className="space-y-5 rounded-2xl border border-line bg-surface p-6 print:border-0 print:p-0">
        <header className="space-y-0.5 text-center">
          <p className="text-lg font-semibold">{ctx.workspace.name}</p>
          <p className="text-sm text-muted">Comprobante de cobro · No es un comprobante fiscal</p>
          <p className="tabular text-sm">
            Folio <span className="font-semibold">#{charge.folio}</span> · {formatInstant(charge.created_at, tz)}
          </p>
        </header>
        <dl className="space-y-0.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Paciente</dt>
            <dd>{detail.contactName ?? "Venta de mostrador"}</dd>
          </div>
          {detail.cashierName ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Atendió</dt>
              <dd>{detail.cashierName}</dd>
            </div>
          ) : null}
        </dl>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left text-xs text-muted">
              <th className="py-1 font-medium">Concepto</th>
              <th className="py-1 text-right font-medium">Cant.</th>
              <th className="py-1 text-right font-medium">Precio</th>
              <th className="py-1 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {items.map((i) => (
              <tr key={i.id} className="border-b border-line">
                <td className="py-1.5 pr-2">{i.description}</td>
                <td className="py-1.5 text-right">{i.quantity}</td>
                <td className="py-1.5 text-right">{formatMoney(i.unit_price)}</td>
                <td className="py-1.5 text-right">{formatMoney(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="tabular ml-auto max-w-60 space-y-0.5 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-muted">Subtotal</dt>
            <dd>{formatMoney(charge.subtotal)}</dd>
          </div>
          {charge.discount > 0 ? (
            <div className="flex justify-between gap-6">
              <dt className="text-muted">Descuento</dt>
              <dd>−{formatMoney(charge.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-6 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatMoney(charge.total)}</dd>
          </div>
        </dl>
        <section aria-label="Pagos" className="space-y-0.5 border-t border-line pt-3 text-sm">
          {payments.map((p) => (
            <p key={p.id} className="tabular flex justify-between gap-4">
              <span>
                {PAYMENT_LABEL[p.method]}
                {p.reference ? <span className="text-muted"> · {p.reference}</span> : null}
              </span>
              <span>{formatMoney(p.amount)}</span>
            </p>
          ))}
        </section>
        {charge.notes ? <p className="text-sm text-muted">Nota: {charge.notes}</p> : null}
      </article>
    </div>
  );
}
