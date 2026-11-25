import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import type { BooleanFeatureCode, LimitCode } from "../catalog";
import { checkFeature, checkLimit, type Entitlements } from "../entitlements";
import { featureLabel } from "../presenter";

type GateProps = {
  entitlements: Entitlements;
  /** Función del plan requerida. */
  feature?: BooleanFeatureCode;
  /** Límite de uso requerido (se intenta agregar `adding` más). */
  limit?: { code: LimitCode; usage: number; adding?: number };
  /** Además exige que el espacio no esté en modo de consulta. */
  write?: boolean;
  /** Administración ve el botón para cambiar de plan; los demás, a quién pedírselo. */
  canManageBilling: boolean;
  title?: string;
  /** Versión en línea (para tarjetas y botones), en lugar de un bloque completo. */
  compact?: boolean;
  children: ReactNode;
};

/**
 * Muestra el contenido si el plan del espacio lo permite y, si no, una
 * restricción consistente con la explicación y el camino para resolverla.
 * IMPORTANTE: ocultar no basta. Toda acción protegida se vuelve a verificar en
 * el servidor (features/billing/server.ts y la base de datos).
 */
export function SubscriptionFeatureGate({ entitlements, feature, limit, write = false, canManageBilling, title, compact = false, children }: GateProps) {
  let message: string | null = null;
  if (feature) {
    const check = checkFeature(entitlements, feature, { write });
    if (!check.allowed) message = check.message;
  }
  if (!message && limit) {
    const check = checkLimit(entitlements, limit.code, limit.usage, limit.adding ?? 1);
    if (!check.allowed) message = check.message ?? "Tu plan no permite esta operación.";
  }
  if (!message) return <>{children}</>;
  return <LockedFeature title={title ?? (feature ? featureLabel(feature) : "Límite del plan")} message={message} canManageBilling={canManageBilling} compact={compact} />;
}

export function LockedFeature({ title, message, canManageBilling, compact = false }: { title: string; message: string; canManageBilling: boolean; compact?: boolean }) {
  const action = canManageBilling ? (
    <Link href="/configuracion/suscripcion" className={buttonClass("primary", compact ? "sm" : "md")}>
      Ver planes
    </Link>
  ) : (
    <p className="text-xs text-muted">Pide a la Administración del espacio que revise el plan.</p>
  );
  if (compact) {
    return (
      <div role="note" className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-3 py-2 text-sm">
        <Lock className="size-4 shrink-0 text-brand-700" aria-hidden />
        <span className="min-w-0 flex-1 text-ink-soft">{message}</span>
        {action}
      </div>
    );
  }
  return (
    <section role="note" aria-label={`${title}: no disponible en tu plan`} className="flex flex-col items-center rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 px-6 py-10 text-center">
      <span className="rounded-full bg-surface p-3 text-brand-700 shadow-sm">
        <Lock className="size-6" aria-hidden />
      </span>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-ink-soft">{message}</p>
      <div className="mt-4">{action}</div>
    </section>
  );
}
