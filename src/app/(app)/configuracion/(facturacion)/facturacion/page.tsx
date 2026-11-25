import { FileText, Receipt } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/layout";
import { BillingHistoryTable } from "@/features/billing/components/billing-history-table";
import { formatCents } from "@/features/billing/pricing";
import { loadWorkspaceBilling } from "@/features/billing/workspace";

export const metadata: Metadata = { title: "Facturación" };

export default async function BillingHistoryPage() {
  const data = await loadWorkspaceBilling();
  if (!data) return null;
  const { ctx, actor, service, overview } = data;
  const invoices = await service.listInvoices(actor, ctx.workspace.id);
  const tz = overview.account?.timezone ?? ctx.workspace.timezone;
  const paid = invoices.filter((i) => i.status === "paid").reduce((n, i) => n + i.amount_cents, 0);
  const open = invoices.filter((i) => i.status === "open");

  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Comprobantes de demostración">
        Los cobros de esta sección son simulados. Los comprobantes descargables no tienen validez fiscal y no son facturas electrónicas (CFDI).
      </Alert>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">Pagado (simulado)</p>
          <p className="tabular mt-1 text-2xl font-semibold text-ink">{formatCents(paid)}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">Pendiente</p>
          <p className="tabular mt-1 text-2xl font-semibold text-ink">{formatCents(open.reduce((n, i) => n + i.amount_cents, 0))}</p>
          <p className="text-xs text-muted">{open.length} comprobante(s)</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">Correo de facturación</p>
          <p className="mt-1 truncate font-medium text-ink">{overview.account?.billing_email ?? "—"}</p>
        </div>
      </div>
      <Card>
        <CardHeader title="Historial de cobros" description="Fechas, conceptos, importes y estado de cada pago." />
        <BillingHistoryTable rows={invoices} timezone={tz} />
      </Card>
      <section aria-labelledby="cfdi" className="rounded-2xl border border-dashed border-line-strong p-5">
        <h2 id="cfdi" className="flex items-center gap-2 font-semibold text-ink">
          <FileText className="size-5 text-brand-700" aria-hidden />
          Facturación electrónica (CFDI)
          <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">Próximamente</span>
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Se integrará un proveedor autorizado de certificación (PAC) para emitir CFDI 4.0 de cada cobro real, con tus datos fiscales (RFC, razón social, régimen y código postal). Hasta
          entonces no se emiten facturas fiscales.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Receipt className="size-4" aria-hidden />
          Los comprobantes de demostración muestran la leyenda «sin validez fiscal».
        </p>
      </section>
    </div>
  );
}
