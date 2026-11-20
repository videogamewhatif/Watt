"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom } from "@/lib/action-result";
import { errorMessage, logError } from "@/lib/errors";
import { ACTIVE_WORKSPACE_COOKIE, getAuthUser, getWorkspaces } from "@/lib/session";

async function rememberWorkspace(id: string) {
  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Cambia el espacio activo. Solo acepta espacios donde la cuenta tiene membresía. */
export async function switchWorkspace(organizationId: string) {
  const { workspaces } = await getWorkspaces();
  if (!workspaces.some((w) => w.id === organizationId)) redirect("/inicio");
  await rememberWorkspace(organizationId);
  // Se navega a Inicio sin filtros: no se arrastran selecciones del espacio anterior.
  redirect("/inicio");
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del espacio.").max(120, "El nombre es demasiado largo."),
  kind: z.enum(["hospital", "clinic", "independent"], { error: "Elige el tipo de espacio." }),
  timezone: z.string().min(3, "Elige la zona horaria."),
  alsoProfessional: z.boolean(),
  professionalType: z.string().min(2),
  specialty: z.string().trim().max(120, "La especialidad es demasiado larga."),
  displayName: z.string().trim().max(120, "El nombre es demasiado largo."),
});

export async function createWorkspace(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    timezone: formData.get("timezone") || "America/Mexico_City",
    alsoProfessional: formData.get("alsoProfessional") === "on",
    professionalType: formData.get("professionalType") || "medico",
    specialty: formData.get("specialty") ?? "",
    displayName: formData.get("displayName") ?? "",
  });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const { supabase, user } = await getAuthUser();
  if (!user) redirect("/iniciar-sesion");

  const v = parsed.data;
  // El rol de administración lo asigna la base; no se envía desde el navegador.
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: v.name,
    p_kind: v.kind,
    p_timezone: v.timezone,
    p_also_professional: v.alsoProfessional,
    p_professional_type: v.professionalType,
    p_specialty: v.specialty || null,
    p_display_name: v.displayName || null,
  });
  if (error || !data) {
    logError("create_organization", error);
    return fail(errorMessage(error));
  }
  await rememberWorkspace(data);
  redirect("/inicio");
}

export async function acceptInvitation(token: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) redirect(`/iniciar-sesion?next=${encodeURIComponent(`/invitacion/${token}`)}`);
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error || !data) {
    logError("accept_invitation", error);
    return fail(errorMessage(error));
  }
  await rememberWorkspace(data);
  redirect("/inicio");
}
