// Máquina de estados explícita de una suscripción. Toda transición pasa por
// `transition()`: un evento que no aplica al estado actual se rechaza. La misma
// tabla de pares permitidos existe en PostgreSQL (private.subscription_transition_allowed)
// y una prueba verifica que coincidan.
import type { SubscriptionStatus } from "./types";

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["incomplete", "trialing", "active", "past_due", "grace_period", "unpaid", "canceled", "expired"];

/** Eventos de negocio (los produce la pasarela, el sistema o una persona autorizada). */
export const SUBSCRIPTION_EVENTS = {
  /** Contratación pagada. */
  checkout_completed: { incomplete: "active" },
  /** Alta con periodo de prueba (sin cobro). */
  trial_started: { incomplete: "trialing" },
  /** Fin de la prueba con cobro aprobado. */
  trial_converted: { trialing: "active" },
  /** Fin de la prueba con cobro rechazado. */
  trial_payment_failed: { trialing: "past_due" },
  /** Fin de la prueba sin método de pago o con cancelación programada. */
  trial_expired: { trialing: "expired" },
  /** Renovación cobrada. */
  renewed: { active: "active" },
  /** Cobro de renovación rechazado. Una contratación incompleta sigue incompleta. */
  payment_failed: { active: "past_due", incomplete: "incomplete" },
  /** El reintento también falló: inicia el periodo de gracia. */
  payment_retry_failed: { past_due: "grace_period" },
  /** Terminó el periodo de gracia sin pago. */
  grace_period_expired: { grace_period: "unpaid" },
  /** Pago regularizado. */
  payment_recovered: { past_due: "active", grace_period: "active", unpaid: "active" },
  /** Cambio de plan o de periodicidad (no cambia el estado). */
  plan_changed: { active: "active", trialing: "trialing" },
  /** Llegó el fin del periodo con la cancelación programada. */
  period_ended_canceled: { active: "canceled", trialing: "canceled", past_due: "canceled", grace_period: "canceled" },
  /** Cancelación inmediata (plataforma o impago persistente). */
  canceled_immediately: { active: "canceled", trialing: "canceled", past_due: "canceled", grace_period: "canceled", unpaid: "canceled", incomplete: "canceled" },
  /** La sesión de pago caducó sin completarse. */
  checkout_expired: { incomplete: "expired" },
  /** Nueva contratación sobre una suscripción terminada, con pago aprobado. */
  reactivated: { canceled: "active", expired: "active" },
} as const satisfies Record<string, Partial<Record<SubscriptionStatus, SubscriptionStatus>>>;

export type SubscriptionEvent = keyof typeof SUBSCRIPTION_EVENTS;

export class InvalidTransitionError extends Error {
  readonly domain = "billing";
  readonly code = "invalid_subscription_transition";
  constructor(
    readonly from: SubscriptionStatus,
    readonly event: string,
  ) {
    super(`El evento «${event}» no aplica a una suscripción en estado «${from}».`);
  }
}

export function canTransition(from: SubscriptionStatus, event: SubscriptionEvent): boolean {
  return from in SUBSCRIPTION_EVENTS[event];
}

/** Siguiente estado o error si el evento no aplica. */
export function transition(from: SubscriptionStatus, event: SubscriptionEvent): SubscriptionStatus {
  const next = (SUBSCRIPTION_EVENTS[event] as Partial<Record<SubscriptionStatus, SubscriptionStatus>>)[from];
  if (!next) throw new InvalidTransitionError(from, event);
  return next;
}

/** Pares (desde → hacia) que algún evento produce, incluidos los que no cambian el estado. */
export function allowedStatusPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const map of Object.values(SUBSCRIPTION_EVENTS)) {
    for (const [from, to] of Object.entries(map)) pairs.add(`${from}>${to}`);
  }
  return pairs;
}

/**
 * Acceso a la operación según el estado:
 * - full: todo lo que incluye el plan.
 * - read_only: consulta y exportación; no se crean citas, profesionales ni usuarios.
 *   Nunca se borra información.
 */
export type AccessLevel = "full" | "read_only";

export type SubscriptionAction =
  | "change_plan"
  | "cancel"
  | "undo_cancel"
  | "reactivate"
  | "retry_payment"
  | "update_payment_method"
  | "complete_checkout"
  | "manage";

export type StatusInfo = {
  label: string;
  tone: "success" | "info" | "warning" | "error" | "neutral";
  access: AccessLevel;
  /** ¿Se renueva automáticamente al final del periodo? */
  renews: boolean;
  /** Mensaje para quien administra el espacio. */
  message: string;
  actions: SubscriptionAction[];
  /** Plantilla de aviso al entrar en el estado. */
  notification: string | null;
};

export const STATUS_INFO: Record<SubscriptionStatus, StatusInfo> = {
  incomplete: {
    label: "Contratación incompleta",
    tone: "warning",
    access: "read_only",
    renews: false,
    message: "Falta completar el pago para activar el plan. Tu información está a salvo.",
    actions: ["complete_checkout"],
    notification: null,
  },
  trialing: {
    label: "Periodo de prueba",
    tone: "info",
    access: "full",
    renews: true,
    message: "Estás usando el plan en periodo de prueba. Al terminar se cobrará el plan elegido con tu método de pago.",
    actions: ["change_plan", "cancel", "undo_cancel", "update_payment_method", "manage"],
    notification: null,
  },
  active: {
    label: "Activa",
    tone: "success",
    access: "full",
    renews: true,
    message: "Tu suscripción está al corriente.",
    actions: ["change_plan", "cancel", "undo_cancel", "update_payment_method", "manage"],
    notification: "subscription_activated",
  },
  past_due: {
    label: "Pago vencido",
    tone: "warning",
    access: "full",
    renews: true,
    message: "No pudimos procesar el último cobro. Conservas el acceso completo mientras reintentamos; actualiza tu método de pago para evitar interrupciones.",
    actions: ["retry_payment", "update_payment_method", "cancel", "manage"],
    notification: "payment_failed",
  },
  grace_period: {
    label: "Periodo de gracia",
    tone: "warning",
    access: "full",
    renews: true,
    message: "El cobro sigue pendiente. Mantienes el acceso completo hasta que termine el periodo de gracia; después el espacio pasará a modo de consulta.",
    actions: ["retry_payment", "update_payment_method", "cancel", "manage"],
    notification: "payment_reminder",
  },
  unpaid: {
    label: "Impago",
    tone: "error",
    access: "read_only",
    renews: false,
    message: "El espacio está en modo de consulta por falta de pago. Puedes ver y exportar toda tu información; regulariza el pago para volver a operar.",
    actions: ["retry_payment", "update_payment_method", "cancel"],
    notification: "payment_reminder",
  },
  canceled: {
    label: "Cancelada",
    tone: "neutral",
    access: "read_only",
    renews: false,
    message: "La suscripción terminó. Tu información se conserva en modo de consulta y puedes reactivar un plan cuando quieras.",
    actions: ["reactivate"],
    notification: "subscription_canceled",
  },
  expired: {
    label: "Vencida",
    tone: "neutral",
    access: "read_only",
    renews: false,
    message: "El periodo terminó sin renovarse. Tu información se conserva en modo de consulta y puedes contratar un plan para continuar.",
    actions: ["reactivate"],
    notification: null,
  },
};

/** Etiquetas del historial de cambios. */
export const EVENT_LABEL: Record<string, string> = {
  checkout_started: "Contratación iniciada",
  checkout_completed: "Contratación pagada",
  checkout_failed: "Pago de contratación rechazado",
  checkout_pending: "Pago de contratación pendiente",
  checkout_canceled: "Proceso de pago cancelado",
  checkout_expired: "Sesión de pago caducada",
  trial_started: "Periodo de prueba iniciado",
  trial_converted: "Prueba convertida en suscripción",
  trial_payment_failed: "Cobro al terminar la prueba rechazado",
  trial_expired: "Periodo de prueba terminado",
  renewed: "Renovación cobrada",
  payment_failed: "Cobro rechazado",
  payment_retry_failed: "Reintento de cobro rechazado",
  grace_period_expired: "Terminó el periodo de gracia",
  payment_recovered: "Pago regularizado",
  plan_changed: "Cambio de plan aplicado",
  plan_change_scheduled: "Cambio de plan programado",
  plan_change_canceled: "Cambio de plan programado cancelado",
  cancel_scheduled: "Cancelación programada",
  cancel_undone: "Cancelación deshecha",
  period_ended_canceled: "Suscripción cancelada al final del periodo",
  canceled_immediately: "Suscripción cancelada",
  reactivated: "Suscripción reactivada",
  payment_method_updated: "Método de pago actualizado",
  status_changed: "Cambio de estado",
};
