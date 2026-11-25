import "server-only";
import { cache } from "react";
import { isDemoEnabled } from "@/lib/demo/personas";
import { hasSupabaseEnv } from "@/lib/env";
import { type AppContext, getAppContext, getAuthUser, getWorkspaces } from "@/lib/session";
import { checkFeature, checkLimit, type Entitlements, UNMANAGED } from "./entitlements";
import type { BooleanFeatureCode, LimitCode } from "./catalog";
import { InMemoryBillingRepository } from "./memory-repository";
import { DemoInboxSender } from "./notifications";
import { MockBillingProvider } from "./providers/mock";
import { buildBillingSeed } from "./seed";
import { BillingService, type Usage } from "./service";
import type { Actor, PlatformRole } from "./types";

/**
 * - demo: pasarela simulada y datos ficticios en memoria (desarrollo o WATTALIS_DEMO=1).
 * - disabled: sin facturación; los espacios no tienen restricciones comerciales.
 * - stripe: configurado pero aún no implementado → se comporta como disabled y lo avisa.
 */
export type BillingMode = "demo" | "disabled" | "stripe";

export function billingMode(): BillingMode {
  const configured = process.env.WATTALIS_BILLING_PROVIDER?.trim().toLowerCase();
  if (configured === "stripe") return "stripe";
  if (configured === "none") return "disabled";
  // La pasarela simulada nunca se activa en producción sin WATTALIS_DEMO=1.
  return isDemoEnabled() ? "demo" : "disabled";
}

/** ¿Existe el servicio de facturación de demostración en este entorno? (catálogo, webhook, reinicio) */
export function billingEnabled() {
  return billingMode() === "demo";
}

/**
 * ¿Se aplica la facturación a esta solicitud? En la demostración solo a las
 * sesiones del modo de prueba, salvo que se active explícitamente con
 * WATTALIS_BILLING_PROVIDER=mock. Así, una cuenta real de Supabase en desarrollo
 * no queda restringida por datos ficticios: sus espacios funcionan como antes.
 */
export const isBillingActive = cache(async (): Promise<boolean> => {
  if (!billingEnabled()) return false;
  if (process.env.WATTALIS_BILLING_PROVIDER?.trim().toLowerCase() === "mock") return true;
  const { demo } = await getAuthUser();
  return Boolean(demo);
});

function appUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

const globalForBilling = globalThis as unknown as { __wattalisBilling?: BillingService };

/** Servicio de la demostración (uno por proceso; sobrevive a la recarga en caliente). */
export function getBillingService(): BillingService {
  if (!billingEnabled()) throw new Error("La facturación no está habilitada.");
  globalForBilling.__wattalisBilling ??= new BillingService({
    repo: new InMemoryBillingRepository(buildBillingSeed(new Date(), appUrl()), () => buildBillingSeed(new Date(), appUrl())),
    provider: new MockBillingProvider({ secret: process.env.WATTALIS_MOCK_WEBHOOK_SECRET }),
    sender: new DemoInboxSender(),
    appUrl: appUrl(),
  });
  return globalForBilling.__wattalisBilling;
}

/** Vuelve a los datos ficticios iniciales de facturación. */
export async function resetBillingDemo() {
  if (!billingEnabled()) return;
  await getBillingService().resetDemoData();
}

/** Rol de plataforma (equipo Wattalis). Nunca se deduce del rol en una clínica. */
export const getPlatformRole = cache(async (): Promise<PlatformRole | null> => {
  const { user, demo, supabase } = await getAuthUser();
  if (!user) return null;
  if (demo) return demo.platformRole ?? null;
  if (!hasSupabaseEnv()) return null;
  const { data, error } = await supabase.from("platform_admins").select("role").eq("user_id", user.id).maybeSingle();
  return error ? null : (data?.role ?? null);
});

/** Quién actúa, con sus membresías verificadas en el servidor. */
export const getBillingActor = cache(async (): Promise<Actor | null> => {
  const { user } = await getAuthUser();
  if (!user) return null;
  const [{ workspaces }, platformRole] = await Promise.all([getWorkspaces(), getPlatformRole()]);
  return {
    userId: user.id,
    email: user.email ?? "",
    memberships: workspaces.map((w) => ({ organizationId: w.id, role: w.role })),
    platformRole,
  };
});

/** Entitlements del espacio activo (una vez por solicitud). Sin facturación: sin restricciones. */
export const getWorkspaceEntitlements = cache(async (): Promise<Entitlements> => {
  if (!(await isBillingActive())) return UNMANAGED;
  const ctx = await getAppContext();
  return getBillingService().getEntitlements(null, ctx.workspace.id);
});

/**
 * Espacio recién creado desde /bienvenida: inicia el periodo de prueba. La
 * membresía se vuelve a leer de la base (no se da por buena). Nunca impide
 * crear el espacio si algo falla.
 */
export async function startTrialForNewWorkspace(workspaceId: string, details: { name: string; kind: string; timezone: string; email: string; contactName: string }) {
  if (!(await isBillingActive())) return;
  try {
    const { supabase, user } = await getAuthUser();
    if (!user) return;
    const { data: membership } = await supabase.from("memberships").select("role").eq("organization_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (membership?.role !== "admin") return;
    const actor: Actor = { userId: user.id, email: user.email ?? "", memberships: [{ organizationId: workspaceId, role: "admin" }], platformRole: null };
    await getBillingService().startTrial(actor, workspaceId, { ...details, email: details.email || user.email || "", contactName: details.contactName || details.name });
  } catch (error) {
    console.error("[wattalis] trial:", error instanceof Error ? error.message : "error");
  }
}

/** Estado y fechas del plan del espacio activo (sin importes), para avisos. */
export const getWorkspaceSubscriptionStatus = cache(async () => {
  if (!(await isBillingActive())) return null;
  const ctx = await getAppContext();
  const sub = await getBillingService().getStatusSnapshot(null, ctx.workspace.id);
  if (!sub) return null;
  const daysUntil = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);
  return { ...sub, trialDaysLeft: daysUntil(sub.trial_ends_at), periodDaysLeft: daysUntil(sub.current_period_end) };
});

/** Profesionales activos y usuarios internos (miembros + invitaciones vigentes) del espacio activo. */
export async function countUsage(ctx: AppContext): Promise<Usage> {
  const [{ data: pros }, { data: members }, { data: invites }] = await Promise.all([
    ctx.supabase.from("professionals").select("id").eq("organization_id", ctx.workspace.id).eq("active", true),
    ctx.supabase.from("memberships").select("id").eq("organization_id", ctx.workspace.id),
    ctx.supabase.from("invitations").select("id, expires_at, accepted_at, revoked_at").eq("organization_id", ctx.workspace.id),
  ]);
  const now = Date.now();
  const pending = (invites ?? []).filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at).getTime() > now).length;
  return { professionals: pros?.length ?? 0, users: (members?.length ?? 0) + pending };
}

/**
 * Verificación del lado del servidor antes de agregar profesionales o usuarios.
 * Devuelve el mensaje de rechazo o null si se permite.
 */
export async function capacityError(ctx: AppContext, code: Extract<LimitCode, "professionals.max" | "users.max">): Promise<string | null> {
  const ent = await getWorkspaceEntitlements();
  if (ent.status === "unmanaged") return null;
  const usage = await countUsage(ctx);
  const check = checkLimit(ent, code, code === "professionals.max" ? usage.professionals : usage.users);
  return check.allowed ? null : (check.message ?? "Tu plan no permite esta operación.");
}

/** Función del plan (y, si `write`, que el espacio no esté en modo de consulta). */
export async function featureError(code: BooleanFeatureCode, { write = false }: { write?: boolean } = {}): Promise<string | null> {
  const ent = await getWorkspaceEntitlements();
  const check = checkFeature(ent, code, { write });
  return check.allowed ? null : check.message;
}
