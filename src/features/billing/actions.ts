"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import { errorMessage, logError } from "@/lib/errors";
import { ACTIVE_WORKSPACE_COOKIE, getAppContext, getAuthUser, getWorkspaces, requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";
import { PERIOD_PARAM } from "./presenter";
import { billingErrorOf } from "./providers/types";
import { billingEnabled, countUsage, getBillingActor, getBillingService, isBillingActive } from "./server";
import type { ChangePreview, SimulationAction } from "./service";
import type { Actor, BillingInterval } from "./types";

const interval = z.enum(["month", "year"]);
const NOT_ENABLED = "La facturación en línea no está habilitada en este entorno.";

/** Convierte errores del dominio en mensajes claros; los inesperados se registran sin datos personales. */
function failFrom(error: unknown): ActionResult<never> {
  const known = billingErrorOf(error);
  if (known) return fail(known.message, { code: known.code });
  console.error("[wattalis] billing:", error instanceof Error ? error.message : "error");
  return fail("No se pudo completar la operación. Intenta de nuevo.");
}

async function actorOrFail(): Promise<Actor> {
  const actor = await getBillingActor();
  if (!actor) redirect("/iniciar-sesion");
  return actor;
}

/** Acciones sobre el espacio activo (protege contra formularios abiertos en otra pestaña). */
type Gate = { ok: false; error: ActionResult<never> } | { ok: true; actor: Actor };

async function workspaceActor(organizationId: string): Promise<Gate> {
  if (!(await isBillingActive())) return { ok: false, error: fail(NOT_ENABLED) };
  const { mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return { ok: false, error: fail(WORKSPACE_MISMATCH) };
  return { ok: true, actor: await actorOrFail() };
}

async function setActiveWorkspace(id: string) {
  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

function revalidateBilling() {
  revalidatePath("/", "layout");
}

// =============================================================================
// Contratación (pasos 3 a 6)
// =============================================================================

const organizationSchema = z.object({
  mode: z.enum(["existing", "new"]),
  workspaceId: z.string().optional(),
  planCode: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  interval,
  name: z.string().trim().min(2, "Escribe el nombre de la organización.").max(120, "El nombre es demasiado largo."),
  kind: z.enum(["hospital", "clinic", "independent"], { error: "Elige el tipo de establecimiento." }),
  contactName: z.string().trim().min(2, "Escribe el nombre del responsable.").max(120),
  billingEmail: z.email("Escribe un correo válido.").transform((v) => v.trim().toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v.replace(/\D/g, "").length >= 7, "Escribe al menos 7 dígitos."),
  country: z.string().regex(/^[A-Z]{2}$/, "Elige el país."),
  timezone: z.string().min(3, "Elige la zona horaria."),
});

/** Paso 3: elige o crea la organización y guarda sus datos de facturación. */
export async function saveOrganizationStep(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await isBillingActive())) return fail(NOT_ENABLED);
  const parsed = organizationSchema.safeParse({
    mode: formData.get("mode"),
    workspaceId: formData.get("workspaceId") || undefined,
    planCode: formData.get("planCode"),
    interval: formData.get("interval"),
    name: formData.get("name"),
    kind: formData.get("kind"),
    contactName: formData.get("contactName"),
    billingEmail: String(formData.get("billingEmail") ?? "").trim(),
    phone: formData.get("phone") ?? "",
    country: formData.get("country") || "MX",
    timezone: formData.get("timezone") || "America/Mexico_City",
  });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { supabase, user } = await getAuthUser();
  if (!user) redirect("/suscripcion/registro");

  let workspaceId = v.workspaceId ?? "";
  if (v.mode === "new") {
    // Mismo alta atómica que /bienvenida: la base asigna el rol de administración.
    const { data, error } = await supabase.rpc("create_organization", {
      p_name: v.name,
      p_kind: v.kind,
      p_timezone: v.timezone,
      p_also_professional: v.kind === "independent",
      p_professional_type: "medico",
      p_specialty: null,
      p_display_name: v.kind === "independent" ? v.contactName : null,
    });
    if (error || !data) {
      logError("create_organization_checkout", error);
      return fail(errorMessage(error));
    }
    workspaceId = data;
  } else {
    const { workspaces } = await getWorkspaces();
    if (!workspaces.some((w) => w.id === workspaceId && w.role === "admin")) return fail("Solo Administración del espacio puede contratar un plan para él.", { fieldErrors: { workspaceId: "Elige un espacio que administres." } });
  }

  try {
    // El Actor se vuelve a leer: incluye la membresía recién creada.
    const { workspaces } = await getWorkspaces();
    const actor: Actor = { ...(await actorOrFail()), memberships: workspaces.map((w) => ({ organizationId: w.id, role: w.role })) };
    if (v.mode === "new" && !actor.memberships.some((m) => m.organizationId === workspaceId)) actor.memberships.push({ organizationId: workspaceId, role: "admin" });
    const eligibility = await getBillingService().checkoutEligibility(actor, workspaceId);
    if (!eligibility.ok) return fail(eligibility.reason);
    await getBillingService().ensureAccount(actor, workspaceId, {
      legalName: v.name,
      establishmentType: v.kind,
      contactName: v.contactName,
      billingEmail: v.billingEmail,
      phone: v.phone,
      country: v.country,
      timezone: v.timezone,
    });
  } catch (error) {
    return failFrom(error);
  }
  await setActiveWorkspace(workspaceId);
  redirect(`/suscripcion/resumen?plan=${v.planCode}&periodo=${PERIOD_PARAM[v.interval]}&espacio=${workspaceId}`);
}

const orderSchema = z.object({ workspaceId: z.uuid(), planCode: z.string(), interval, acceptedTerms: z.boolean(), idempotencyKey: z.uuid() });

/** Paso 4: confirma el pedido y abre la sesión de pago de la pasarela. */
export async function confirmOrder(input: z.input<typeof orderSchema>): Promise<ActionResult> {
  if (!(await isBillingActive())) return fail(NOT_ENABLED);
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return fail("Datos del pedido inválidos.");
  const v = parsed.data;
  if (!v.acceptedTerms) return fail("Debes aceptar los términos y condiciones para continuar.", { fieldErrors: { terms: "Acepta los términos para continuar." } });
  let url: string;
  try {
    ({ url } = await getBillingService().startCheckout(await actorOrFail(), v));
  } catch (error) {
    return failFrom(error);
  }
  redirect(url);
}

/** Paso 5 (solo demostración): resultado que devolverá la pasarela simulada. */
export async function simulatePayment(sessionId: string, outcome: "approved" | "declined" | "pending" | "canceled"): Promise<ActionResult> {
  if (!(await isBillingActive())) return fail(NOT_ENABLED);
  if (!["approved", "declined", "pending", "canceled"].includes(outcome)) return fail("Resultado inválido.");
  const actor = await actorOrFail();
  const service = getBillingService();
  let back: string;
  try {
    await service.simulateCheckout(actor, sessionId, outcome);
    const found = await service.getCheckout(actor, sessionId);
    if (!found) return fail("Sesión de pago no encontrada.");
    back =
      outcome === "canceled"
        ? `/suscripcion/resumen?plan=${found.plan.code}&periodo=${PERIOD_PARAM[found.session.billing_interval]}&espacio=${found.account.organization_id}&cancelado=1`
        : `/suscripcion/confirmacion?sesion=${sessionId}`;
  } catch (error) {
    return failFrom(error);
  }
  revalidateBilling();
  redirect(back);
}

/** Paso 6: entra al espacio contratado. */
export async function enterWorkspace(workspaceId: string) {
  const { workspaces } = await getWorkspaces();
  if (!workspaces.some((w) => w.id === workspaceId)) redirect("/inicio");
  await setActiveWorkspace(workspaceId);
  redirect("/inicio");
}

const leadSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(120),
  email: z.email("Escribe un correo válido.").transform((v) => v.trim().toLowerCase()),
  organization: z.string().trim().min(2, "Escribe la organización.").max(160),
  workspaces: z.coerce.number().int().min(1, "Al menos 1.").max(500),
  message: z.string().trim().max(1000).default(""),
});

/** Solicitud de contacto para el plan Corporativo (en la demostración se guarda en el panel de la plataforma). */
export async function submitSalesLead(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = leadSchema.safeParse({
    name: formData.get("name"),
    email: String(formData.get("email") ?? "").trim(),
    organization: formData.get("organization"),
    workspaces: formData.get("workspaces") || 1,
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  if (!billingEnabled()) return fail("El canal comercial aún no está configurado en este entorno.");
  await getBillingService().submitLead(parsed.data);
  return ok(undefined, "Recibimos tu solicitud. El equipo comercial te contactará (en esta demostración, la solicitud solo queda registrada en el panel de Wattalis).");
}

// =============================================================================
// Configuración → Suscripción y facturación (Administración del espacio)
// =============================================================================

export type PreviewDTO = Omit<ChangePreview, "currentPlan" | "targetPlan"> & {
  currentPlan: { code: string; name: string };
  targetPlan: { code: string; name: string };
};

export async function previewPlanChange(organizationId: string, planCode: string, period: BillingInterval): Promise<ActionResult<PreviewDTO>> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    const ctx = await getAppContext();
    const p = await getBillingService().previewChange(r.actor, organizationId, planCode, interval.parse(period), await countUsage(ctx));
    return ok({ ...p, currentPlan: { code: p.currentPlan.code, name: p.currentPlan.name }, targetPlan: { code: p.targetPlan.code, name: p.targetPlan.name } });
  } catch (error) {
    return failFrom(error);
  }
}

export async function applyPlanChange(organizationId: string, planCode: string, period: BillingInterval): Promise<ActionResult<{ applied: boolean; effectiveAt: string }>> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    const ctx = await getAppContext();
    const result = await getBillingService().changePlan(r.actor, organizationId, planCode, interval.parse(period), await countUsage(ctx));
    revalidateBilling();
    return ok({ applied: result.applied, effectiveAt: result.effectiveAt }, result.applied ? `Listo: tu espacio ya usa el plan ${result.preview.targetPlan.name}.` : `Cambio programado al plan ${result.preview.targetPlan.name}.`);
  } catch (error) {
    return failFrom(error);
  }
}

export async function cancelScheduledPlanChange(organizationId: string): Promise<ActionResult> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    await getBillingService().cancelScheduledChange(r.actor, organizationId);
    revalidateBilling();
    return ok(undefined, "Cancelaste el cambio de plan programado.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function cancelSubscription(organizationId: string, reason: string | null): Promise<ActionResult<{ accessUntil: string | null }>> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    const result = await getBillingService().scheduleCancellation(r.actor, organizationId, reason);
    revalidateBilling();
    return ok(result, result.accessUntil ? "La suscripción no se renovará. Conservas el acceso hasta el final del periodo." : "La suscripción se canceló. Tu información se conserva en modo de consulta.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function undoCancellation(organizationId: string): Promise<ActionResult> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    await getBillingService().undoCancellation(r.actor, organizationId);
    revalidateBilling();
    return ok(undefined, "Listo: tu suscripción se renovará normalmente.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function retrySubscriptionPayment(organizationId: string): Promise<ActionResult<{ result: string }>> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    const { result } = await getBillingService().retryPaymentAsUser(r.actor, organizationId);
    revalidateBilling();
    return result === "approved" ? ok({ result }, "Pago aprobado (simulado). Tu suscripción está al corriente.") : fail("La pasarela de demostración rechazó el cobro. Prueba con otra tarjeta de prueba.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function addDemoPaymentMethod(organizationId: string, cardKey: string): Promise<ActionResult> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    await getBillingService().addPaymentMethod(r.actor, organizationId, cardKey, true);
    revalidateBilling();
    return ok(undefined, "Método de pago de prueba guardado como predeterminado.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function setDefaultPaymentMethod(organizationId: string, methodId: string): Promise<ActionResult> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    await getBillingService().setDefaultPaymentMethod(r.actor, organizationId, methodId);
    revalidateBilling();
    return ok(undefined, "Método predeterminado actualizado.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function removePaymentMethod(organizationId: string, methodId: string): Promise<ActionResult<{ remaining: number }>> {
  const r = await workspaceActor(organizationId);
  if (!r.ok) return r.error;
  try {
    const result = await getBillingService().removePaymentMethod(r.actor, organizationId, methodId);
    revalidateBilling();
    return ok(result, "Método de pago eliminado.");
  } catch (error) {
    return failFrom(error);
  }
}

// =============================================================================
// Panel de la plataforma (rol de plataforma; se vuelve a validar en el servicio)
// =============================================================================

async function platformActor(): Promise<Gate> {
  if (!(await isBillingActive())) return { ok: false, error: fail(NOT_ENABLED) };
  return { ok: true, actor: await actorOrFail() };
}

export async function adminUpdatePlan(planId: string, patch: { name?: string; description?: string; monthlyPrice?: string; badge?: string | null; isActive?: boolean }): Promise<ActionResult> {
  const r = await platformActor();
  if (!r.ok) return r.error;
  let monthly: number | undefined;
  if (patch.monthlyPrice !== undefined) {
    const clean = patch.monthlyPrice.replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return fail("Escribe un precio válido (por ejemplo 899 o 899.50).", { fieldErrors: { monthlyPrice: "Precio inválido." } });
    monthly = Math.round(Number(clean) * 100);
  }
  try {
    await getBillingService().adminUpdatePlan(r.actor, planId, { name: patch.name, description: patch.description, badge: patch.badge, is_active: patch.isActive, monthly_price_cents: monthly });
    revalidateBilling();
    return ok(undefined, "Plan actualizado.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function adminUpdateEntitlements(planId: string, entries: { feature_code: string; enabled: boolean; usage_limit: number | null }[]): Promise<ActionResult> {
  const r = await platformActor();
  if (!r.ok) return r.error;
  try {
    await getBillingService().adminUpdateEntitlements(r.actor, planId, entries);
    revalidateBilling();
    return ok(undefined, "Beneficios y límites actualizados.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function adminUpdateSettings(patch: { annualDiscount?: number; graceDays?: number; taxRate?: number; pricesIncludeTax?: boolean; trialDays?: number; enforceLimits?: boolean }): Promise<ActionResult> {
  const r = await platformActor();
  if (!r.ok) return r.error;
  try {
    await getBillingService().adminUpdateSettings(r.actor, {
      annual_discount_bps: patch.annualDiscount === undefined ? undefined : Math.round(patch.annualDiscount * 100),
      grace_period_days: patch.graceDays,
      tax_rate_bps: patch.taxRate === undefined ? undefined : Math.round(patch.taxRate * 100),
      prices_include_tax: patch.pricesIncludeTax,
      trial_days: patch.trialDays,
      enforce_limits: patch.enforceLimits,
    });
    revalidateBilling();
    return ok(undefined, "Configuración comercial actualizada.");
  } catch (error) {
    return failFrom(error);
  }
}

const SIMULATIONS: SimulationAction[] = ["renew_approved", "renew_declined", "retry_approved", "retry_declined", "expire_grace", "cancel_now", "notify_renewal", "notify_trial_ending"];

export async function adminSimulate(subscriptionId: string, action: SimulationAction): Promise<ActionResult> {
  const r = await platformActor();
  if (!r.ok) return r.error;
  if (!SIMULATIONS.includes(action)) return fail("Simulación desconocida.");
  try {
    await getBillingService().adminSimulate(r.actor, subscriptionId, action);
    revalidateBilling();
    return ok(undefined, "Simulación aplicada. Ningún cargo es real.");
  } catch (error) {
    return failFrom(error);
  }
}

export async function adminResetDemo(): Promise<ActionResult> {
  const r = await platformActor();
  if (!r.ok) return r.error;
  try {
    await getBillingService().adminReset(r.actor);
    revalidateBilling();
    return ok(undefined, "Datos de facturación de demostración reiniciados.");
  } catch (error) {
    return failFrom(error);
  }
}
