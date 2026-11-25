import { CircleAlert, Clock, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Entitlements } from "../entitlements";
import type { SubscriptionRow } from "../types";

const fmt = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: tz }).format(new Date(iso)) : "");

/**
 * Aviso del estado de la suscripción bajo el encabezado de la aplicación.
 * Modo de consulta: lo ven todos. Cobros y renovación: solo Administración.
 */
export function SubscriptionBanner({
  entitlements,
  subscription,
  canManageBilling,
  timezone,
}: {
  entitlements: Entitlements;
  subscription: (SubscriptionRow & { trialDaysLeft: number | null; periodDaysLeft: number | null }) | null;
  canManageBilling: boolean;
  timezone: string;
}) {
  if (entitlements.status === "unmanaged") return null;
  const link = canManageBilling ? (
    <Link href="/configuracion/suscripcion" className="font-semibold underline underline-offset-2">
      {entitlements.access === "read_only" ? "Ver opciones" : "Revisar"}
    </Link>
  ) : null;

  let tone = "";
  let Icon = CircleAlert;
  let text: string | null = null;
  if (entitlements.access === "read_only") {
    tone = "border-red-200 bg-red-50 text-red-950";
    Icon = Lock;
    text =
      entitlements.status === "none"
        ? "Este espacio no tiene un plan activo: está en modo de consulta. Puedes ver y exportar toda tu información."
        : entitlements.status === "incomplete"
          ? "La contratación está pendiente de pago: el espacio está en modo de consulta."
          : "El espacio está en modo de consulta: puedes ver y exportar tu información, pero no registrar citas, profesionales ni usuarios. No se ha borrado nada.";
    if (!canManageBilling) text += " Pide a la Administración del espacio que regularice el plan.";
  } else if (canManageBilling && subscription) {
    if (subscription.status === "past_due") {
      tone = "border-amber-200 bg-amber-50 text-amber-950";
      text = "No pudimos procesar el último cobro de tu suscripción. Conservas el acceso completo; actualiza tu método de pago.";
    } else if (subscription.status === "grace_period") {
      tone = "border-amber-300 bg-amber-50 text-amber-950";
      Icon = Clock;
      text = `Pago pendiente: tu periodo de gracia termina el ${fmt(subscription.grace_ends_at, timezone)}. Después, el espacio pasará a modo de consulta.`;
    } else if (subscription.cancel_at_period_end && (subscription.periodDaysLeft ?? Infinity) <= 15) {
      tone = "border-stone-200 bg-stone-50 text-stone-800";
      Icon = Clock;
      text = `Tu suscripción no se renovará. Conservas el acceso hasta el ${fmt(subscription.current_period_end, timezone)}.`;
    } else if (subscription.status === "trialing" && (subscription.trialDaysLeft ?? Infinity) <= 10) {
      tone = "border-sky-200 bg-sky-50 text-sky-950";
      Icon = Sparkles;
      text = `Tu periodo de prueba termina el ${fmt(subscription.trial_ends_at, timezone)}.`;
    }
  }
  if (!text) return null;
  return (
    <div role="status" className={`border-b px-3 py-2 text-sm sm:px-5 print:hidden ${tone}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span>{text}</span>
        {link}
      </p>
    </div>
  );
}
