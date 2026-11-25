import { Download } from "lucide-react";
import { formatCents } from "../pricing";
import type { InvoiceRow, PaymentAttemptRow } from "../types";

type Row = InvoiceRow & { attempts: PaymentAttemptRow[] };

function paymentState(row: Row): { label: string; className: string } {
  const last = row.attempts[0];
  if (row.status === "paid") return { label: "Pagado", className: "bg-emerald-50 text-emerald-900 ring-emerald-300" };
  if (row.status === "void") return { label: "Anulado", className: "bg-stone-100 text-stone-700 ring-stone-300" };
  if (row.status === "uncollectible") return { label: "Incobrable", className: "bg-red-50 text-red-900 ring-red-300" };
  if (last?.status === "failed") return { label: "Rechazado", className: "bg-red-50 text-red-900 ring-red-300" };
  if (last?.status === "pending") return { label: "Pendiente de confirmación", className: "bg-amber-50 text-amber-950 ring-amber-300" };
  return { label: "Pendiente", className: "bg-amber-50 text-amber-950 ring-amber-300" };
}

const fmt = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: tz }).format(new Date(iso)) : "—");

/** Historial de cobros. Tabla en pantallas medianas y tarjetas en teléfonos. */
export function BillingHistoryTable({ rows, timezone }: { rows: Row[]; timezone: string }) {
  if (!rows.length) return <p className="px-5 py-10 text-center text-sm text-muted">Aún no hay cobros registrados.</p>;
  return (
    <>
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r) => {
          const state = paymentState(r);
          return (
            <li key={r.id} className="space-y-1.5 px-4 py-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-ink">{r.description}</p>
                <p className="tabular font-semibold text-ink">{formatCents(r.amount_cents)}</p>
              </div>
              <p className="text-muted">
                {fmt(r.issued_at, timezone)} · {r.invoice_reference}
              </p>
              <div className="flex items-center justify-between gap-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${state.className}`}>{state.label}</span>
                <a href={`/configuracion/facturacion/comprobante/${r.id}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  <Download className="size-4" aria-hidden />
                  Comprobante
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="relative hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Historial de cobros de la suscripción</caption>
          <thead className="border-b border-line bg-canvas text-left text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-3">
                Fecha
              </th>
              <th scope="col" className="px-3 py-3">
                Concepto
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Importe
              </th>
              <th scope="col" className="px-3 py-3">
                Estado del pago
              </th>
              <th scope="col" className="px-3 py-3">
                Referencia de operación
              </th>
              <th scope="col" className="px-5 py-3 text-right">
                <span className="sr-only">Comprobante</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const state = paymentState(r);
              const op = r.attempts.find((a) => a.provider_payment_id)?.provider_payment_id;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-5 py-3 whitespace-nowrap text-ink-soft">{fmt(r.issued_at, timezone)}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-ink">{r.description}</span>
                    {r.period_start && r.period_end ? (
                      <span className="block text-xs text-muted">
                        Periodo: {fmt(r.period_start, timezone)} – {fmt(r.period_end, timezone)}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-3 text-right font-semibold whitespace-nowrap text-ink">
                    {formatCents(r.amount_cents)}
                    <span className="block text-xs font-normal text-muted">IVA {formatCents(r.tax_cents)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${state.className}`}>{state.label}</span>
                    {r.attempts[0]?.failure_reason && r.status !== "paid" ? <span className="mt-1 block text-xs text-muted">{r.attempts[0].failure_reason}</span> : null}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-ink-soft">
                    {r.invoice_reference}
                    {op ? <span className="block text-muted">{op}</span> : null}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <a
                      href={`/configuracion/facturacion/comprobante/${r.id}`}
                      className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-brand-700 hover:underline"
                      aria-label={`Descargar comprobante de demostración ${r.invoice_reference}`}
                    >
                      <Download className="size-4" aria-hidden />
                      Descargar
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
