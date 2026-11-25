import type { NextRequest } from "next/server";
import { formatCents } from "@/features/billing/pricing";
import { getBillingActor, getBillingService, isBillingActive } from "@/features/billing/server";
import { getAppContext } from "@/lib/session";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STATUS: Record<string, string> = { paid: "Pagado", open: "Pendiente", void: "Anulado", uncollectible: "Incobrable" };

/**
 * Comprobante de DEMOSTRACIÓN (HTML imprimible). Nunca es un CFDI. Solo lo
 * descarga Administración del espacio dueño de la cuenta; para cualquier otro
 * responde 404 (no revela si existe).
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/configuracion/facturacion/comprobante/[id]">) {
  const { id } = await params;
  if (!(await isBillingActive())) return text("Comprobante no encontrado.", 404);
  const ctx = await getAppContext();
  const actor = await getBillingActor();
  if (!actor || !ctx.can.manageBilling) return text("Comprobante no encontrado.", 404);
  let found: Awaited<ReturnType<ReturnType<typeof getBillingService>["getInvoice"]>> = null;
  try {
    found = await getBillingService().getInvoice(actor, ctx.workspace.id, id);
  } catch {
    found = null;
  }
  if (!found) return text("Comprobante no encontrado.", 404);
  const { invoice, account, plan } = found;
  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: account.timezone }).format(new Date(iso)) : "—");
  const html = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>Comprobante de demostración ${esc(invoice.invoice_reference)}</title>
<style>
body{font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;color:#1b2528;margin:0;padding:32px;background:#f6f5f1}
.sheet{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e2dfd7;border-radius:16px;padding:32px;position:relative;overflow:hidden}
.watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:rotate(-24deg);font-size:44px;font-weight:800;color:rgba(194,65,12,.09);pointer-events:none;text-align:center}
.banner{background:#fffbeb;border:2px solid #f59e0b;color:#78350f;border-radius:10px;padding:12px 14px;font-weight:700;margin-bottom:24px}
h1{font-size:20px;margin:0 0 4px}.muted{color:#5f6b6e;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:20px;font-size:14px}td{padding:8px 0;border-bottom:1px solid #eee}td:last-child{text-align:right}
.total td{font-weight:700;font-size:16px;border-bottom:none}
@media print{body{background:#fff;padding:0}.sheet{border:none}}
</style></head><body><div class="sheet"><div class="watermark">DEMOSTRACIÓN<br>SIN VALIDEZ FISCAL</div>
<div class="banner">COMPROBANTE DE DEMOSTRACIÓN · SIN VALIDEZ FISCAL · NO ES UN CFDI · No corresponde a un cobro bancario real.</div>
<h1>Wattalis · Comprobante de suscripción</h1>
<p class="muted">Referencia: ${esc(invoice.invoice_reference)} · Emitido el ${date(invoice.issued_at)}</p>
<p><strong>${esc(account.legal_name)}</strong><br><span class="muted">${esc(account.billing_email)}</span></p>
<table>
<tr><td>Concepto</td><td>${esc(invoice.description)}${plan ? ` (plan ${esc(plan.name)})` : ""}</td></tr>
<tr><td>Periodo</td><td>${date(invoice.period_start)} – ${date(invoice.period_end)}</td></tr>
<tr><td>Subtotal</td><td>${formatCents(invoice.subtotal_cents)}</td></tr>
<tr><td>IVA</td><td>${formatCents(invoice.tax_cents)}</td></tr>
<tr class="total"><td>Total (MXN)</td><td>${formatCents(invoice.amount_cents)}</td></tr>
<tr><td>Estado del pago</td><td>${STATUS[invoice.status] ?? invoice.status}${invoice.paid_at ? ` · ${date(invoice.paid_at)}` : ""}</td></tr>
</table>
<p class="muted" style="margin-top:24px">Documento generado por el modo de demostración de Wattalis con fines de prueba. La facturación electrónica (CFDI) se emitirá con un proveedor autorizado cuando se habiliten los cobros reales.</p>
</div></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="comprobante-demo-${invoice.invoice_reference}.html"`,
      "Cache-Control": "no-store",
    },
  });
}
