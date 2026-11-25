// Autorización del módulo de facturación, del lado del servidor. Las membresías
// del Actor salen de la sesión verificada (RLS/Supabase o modo de prueba); nunca
// de lo que envía el navegador.
import type { Actor } from "./types";

/**
 * Roles del espacio que administran la suscripción. Hoy solo Administración;
 * cuando exista el rol «responsable de facturación» se agrega aquí y en la
 * política RLS private.billing_admin_org_ids().
 */
export const BILLING_MANAGER_ROLES = ["admin"] as const;

export class BillingAccessError extends Error {
  readonly domain = "billing";
  readonly code = "forbidden";
  constructor(message = "No tienes permiso para consultar o modificar la facturación de este espacio.") {
    super(message);
  }
}

export function isPlatformStaff(actor: Actor | null): boolean {
  return Boolean(actor?.platformRole);
}

export function isPlatformAdmin(actor: Actor | null): boolean {
  return actor?.platformRole === "platform_admin";
}

export function isMemberOf(actor: Actor, organizationId: string): boolean {
  return actor.memberships.some((m) => m.organizationId === organizationId);
}

export function canManageBilling(actor: Actor, organizationId: string): boolean {
  return actor.memberships.some((m) => m.organizationId === organizationId && (BILLING_MANAGER_ROLES as readonly string[]).includes(m.role));
}

/** Administración del espacio (o personal de la plataforma para consulta). */
export function assertCanViewBilling(actor: Actor, organizationId: string) {
  if (!canManageBilling(actor, organizationId) && !isPlatformStaff(actor)) throw new BillingAccessError();
}

/** Solo Administración del espacio modifica su suscripción (la plataforma usa sus propias acciones). */
export function assertCanManageBilling(actor: Actor, organizationId: string) {
  if (!canManageBilling(actor, organizationId)) throw new BillingAccessError();
}

/** Cualquier miembro puede conocer el estado del plan (para mostrar restricciones). */
export function assertCanReadStatus(actor: Actor, organizationId: string) {
  if (!isMemberOf(actor, organizationId) && !isPlatformStaff(actor)) throw new BillingAccessError();
}

export function assertPlatformAdmin(actor: Actor | null) {
  if (!isPlatformAdmin(actor)) throw new BillingAccessError("Esta sección es exclusiva del equipo de administración de Wattalis.");
}

export function assertPlatformStaff(actor: Actor | null) {
  if (!isPlatformStaff(actor)) throw new BillingAccessError("Esta sección es exclusiva del equipo de administración de Wattalis.");
}
