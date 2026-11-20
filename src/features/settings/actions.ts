"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import { errorMessage, logError } from "@/lib/errors";
import { ACTIVE_WORKSPACE_COOKIE, getAppContext, requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";
import { getSiteUrl } from "@/lib/site-url";

const workspaceSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(2, "Escribe el nombre.").max(120, "El nombre es demasiado largo."),
  kind: z.enum(["hospital", "clinic", "independent"]),
  timezone: z.string().min(3, "Elige la zona horaria."),
  slotInterval: z.coerce.number().refine((n) => [5, 10, 15, 20, 30, 60].includes(n), "Elige un intervalo válido."),
});

export async function updateWorkspace(input: z.input<typeof workspaceSchema>): Promise<ActionResult> {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase
    .from("organizations")
    .update({ name: v.name, kind: v.kind, timezone: v.timezone, slot_interval_minutes: v.slotInterval })
    .eq("id", ctx.workspace.id)
    .select("id");
  if (error || !data?.length) {
    logError("update_workspace", error);
    return fail(error ? errorMessage(error) : "Solo la administración puede cambiar el espacio.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Espacio actualizado.");
}

export async function updateProfile(fullName: string): Promise<ActionResult> {
  const parsed = z.string().trim().min(2, "Escribe tu nombre.").max(120, "El nombre es demasiado largo.").safeParse(fullName);
  if (!parsed.success) return fail(parsed.error.issues[0].message, { fieldErrors: { fullName: parsed.error.issues[0].message } });
  const ctx = await getAppContext();
  const { error } = await ctx.supabase.from("profiles").update({ full_name: parsed.data }).eq("id", ctx.user.id);
  if (error) {
    logError("update_profile", error);
    return fail(errorMessage(error));
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Nombre actualizado.");
}

const inviteSchema = z.object({
  organizationId: z.uuid(),
  email: z.email("Escribe un correo válido.").transform((v) => v.trim().toLowerCase()),
  role: z.enum(["admin", "reception", "professional"]),
  professionalId: z.uuid().nullish(),
  validDays: z.coerce.number().int().min(1).max(30),
});

/** Crea un enlace de invitación de un solo uso. El token solo se muestra esta vez. */
export async function inviteMember(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ link: string; expiresAt: string }>> {
  const parsed = inviteSchema.safeParse({ ...input, email: String(input.email ?? "").trim() });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase.rpc("create_invitation", {
    p_organization_id: ctx.workspace.id,
    p_email: v.email,
    p_role: v.role,
    p_professional_id: v.professionalId ?? null,
    p_valid_days: v.validDays,
  });
  const row = data?.[0];
  if (error || !row) {
    logError("create_invitation", error);
    return fail(errorMessage(error));
  }
  revalidatePath("/configuracion");
  const site = await getSiteUrl();
  return ok({ link: `${site}/invitacion/${row.token}`, expiresAt: row.expires_at }, "Invitación creada.");
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("accepted_at", null)
    .select("id");
  if (error || !data?.length) {
    logError("revoke_invitation", error);
    return fail(error ? errorMessage(error) : "No se pudo revocar la invitación.");
  }
  revalidatePath("/configuracion");
  return ok(undefined, "Invitación revocada.");
}

export async function changeMemberRole(organizationId: string, membershipId: string, role: "admin" | "reception" | "professional"): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  if (!["admin", "reception", "professional"].includes(role)) return fail("Rol inválido.");
  const { data, error } = await ctx.supabase.from("memberships").update({ role }).eq("id", membershipId).select("id");
  if (error || !data?.length) {
    logError("change_member_role", error);
    return fail(error ? errorMessage(error) : "Solo la administración puede cambiar roles.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Rol actualizado.");
}

export async function removeMember(organizationId: string, membershipId: string): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase.from("memberships").delete().eq("id", membershipId).select("id");
  if (error || !data?.length) {
    logError("remove_member", error);
    return fail(error ? errorMessage(error) : "No se pudo quitar al miembro.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Miembro quitado del espacio. Su acceso termina de inmediato.");
}

export async function leaveWorkspace(organizationId: string): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { error } = await ctx.supabase.from("memberships").delete().eq("id", ctx.workspace.membershipId);
  if (error) {
    logError("leave_workspace", error);
    return fail(errorMessage(error));
  }
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/inicio");
}
