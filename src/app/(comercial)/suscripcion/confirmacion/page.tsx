import { ArrowRight, CalendarCheck, CircleCheck, Clock, Mail, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { enterWorkspace } from "@/features/billing/actions";
import { AutoRedirect } from "@/features/billing/components/auto-redirect";
import { DemoPaymentForm } from "@/features/billing/components/demo-payment-form";
import { SubscriptionCheckoutStepper } from "@/features/billing/components/subscription-checkout-stepper";
import { formatCents, INTERVAL_LABEL } from "@/features/billing/pricing";
import { PERIOD_PARAM, planHighlights } from "@/features/billing/presenter";
import { getBillingActor, getBillingService, isBillingActive } from "@/features/billing/server";

export const metadata: Metadata = { title: "Confirmación" };

export default async function CheckoutConfirmationPage({ searchParams }: PageProps<"/suscripcion/confirmacion">) {
  const sessionId = (await searchParams).sesion;
  const actor = await getBillingActor();
  if (!actor) redirect("/iniciar-sesion");
  if (!(await isBillingActive()) || typeof sessionId !== "string") notFound();
  const service = getBillingService();
  const found = await service.getCheckout(actor, sessionId);
  if (!found) notFound();
  const { session, plan, account, invoice, subscription } = found;
  const back = `/suscripcion/resumen?plan=${plan.code}&periodo=${PERIOD_PARAM[session.billing_interval]}&espacio=${account.organization_id}`;
  if (session.status === "canceled" || session.status === "expired") redirect(`${back}&cancelado=1`);
  if (session.status === "open") redirect(`/suscripcion/pago?sesion=${session.id}`);
  const go = enterWorkspace.bind(null, account.organization_id);

  if (session.status === "completed") {
    const catalog = await service.getCatalog({ includeInactive: true });
    const { items } = planHighlights(plan, catalog.entitlements, null);
    const renewal = subscription.current_period_end
      ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: account.timezone }).format(new Date(subscription.current_period_end))
      : "—";
    return (
      <div className="animate-step-in">
        <SubscriptionCheckoutStepper current={6} />
        <section aria-labelledby="exito" className="mx-auto max-w-2xl rounded-3xl border border-line bg-surface p-6 text-center shadow-sm sm:p-10">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-8 ring-emerald-50/60">
            <CircleCheck className="size-9" aria-hidden />
          </span>
          <h1 id="exito" className="mt-5 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            ¡Bienvenido a Wattalis! Tu espacio de trabajo está listo.
          </h1>
          <p className="mt-2 text-ink-soft">
            {account.legal_name} ya tiene el plan <span className="font-semibold text-ink">{plan.name}</span> ({INTERVAL_LABEL[session.billing_interval].toLowerCase()}).
          </p>
          <dl className="mx-auto mt-6 grid max-w-md gap-3 text-left text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-canvas p-3">
              <dt className="flex items-center gap-1.5 text-muted">
                <CalendarCheck className="size-4" aria-hidden /> Próxima renovación
              </dt>
              <dd className="mt-0.5 font-semibold text-ink">{renewal}</dd>
            </div>
            <div className="rounded-xl bg-canvas p-3">
              <dt className="flex items-center gap-1.5 text-muted">
                <Mail className="size-4" aria-hidden /> Pago simulado
              </dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {formatCents(invoice.amount_cents)} · {invoice.invoice_reference}
              </dd>
            </div>
          </dl>
          <div className="mx-auto mt-6 max-w-md text-left">
            <p className="text-sm font-medium text-ink">Funciones habilitadas</p>
            <ul className="mt-2 grid gap-1.5 text-sm text-ink-soft sm:grid-cols-2">
              {items.slice(0, 8).map((f) => (
                <li key={f} className="flex gap-2">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <form action={go} className="mt-8">
            <Button type="submit" className="group w-full sm:w-auto" icon={<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}>
              Ir a mi espacio de trabajo
            </Button>
          </form>
          <div className="mt-4 flex justify-center">
            <AutoRedirect action={go} />
          </div>
          <p className="mt-6 text-xs text-muted">Esta contratación es una simulación: no se realizó ningún cobro bancario y el comprobante no tiene validez fiscal.</p>
        </section>
      </div>
    );
  }

  if (session.status === "pending") {
    return (
      <div className="animate-step-in">
        <SubscriptionCheckoutStepper current={6} />
        <section aria-labelledby="pendiente" className="mx-auto max-w-2xl rounded-3xl border border-line bg-surface p-6 sm:p-10">
          <span className="flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <Clock className="size-8" aria-hidden />
          </span>
          <h1 id="pendiente" className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            Tu pago está pendiente de confirmación
          </h1>
          <p className="mt-2 text-ink-soft">
            La pasarela todavía no confirma el pago. Activaremos el plan en cuanto llegue la confirmación; mientras tanto no se realizó ningún cargo y tu espacio sigue disponible en modo de consulta.
          </p>
          <div className="mt-6 rounded-2xl border border-line p-5">
            <p className="mb-4 text-sm font-medium text-ink">Simula la respuesta final de la pasarela:</p>
            <DemoPaymentForm sessionId={session.id} totalLabel={`${formatCents(session.amount_cents)} MXN`} allowCancel={false} outcomes={["approved", "declined"]} />
          </div>
        </section>
      </div>
    );
  }

  // failed
  return (
    <div className="animate-step-in">
      <SubscriptionCheckoutStepper current={6} />
      <section aria-labelledby="rechazado" className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-surface p-6 sm:p-10" role="alert">
        <span className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-700">
          <XCircle className="size-8" aria-hidden />
        </span>
        <h1 id="rechazado" className="mt-4 text-2xl font-semibold tracking-tight text-ink">
          No pudimos completar el pago
        </h1>
        <p className="mt-2 text-ink-soft">
          {session.failure_reason ?? "La pasarela rechazó el cobro."} No se realizó ningún cargo (es una simulación). Tu pedido sigue guardado: puedes reintentar o volver al resumen.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/suscripcion/pago?sesion=${session.id}`} className={buttonClass("primary")}>
            Reintentar la simulación
          </Link>
          <Link href={back} className={buttonClass("secondary")}>
            Volver al resumen
          </Link>
        </div>
      </section>
    </div>
  );
}
