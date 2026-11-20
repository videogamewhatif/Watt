"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import type { ContactRow } from "@/lib/database.types";
import { errorMessage, logError } from "@/lib/errors";
import { requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";

export type ContactSummary = Pick<ContactRow, "id" | "full_name" | "phone" | "email">;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v || null);

const contactSchema = z
  .object({
    organizationId: z.uuid(),
    fullName: z.string().trim().min(2, "Escribe el nombre completo.").max(160, "El nombre es demasiado largo."),
    phone: optionalText(30, "El teléfono es demasiado largo.").refine(
      (v) => v === null || v.replace(/\D/g, "").length >= 7,
      "Escribe un teléfono de al menos 7 dígitos.",
    ),
    email: optionalText(160, "El correo es demasiado largo.").refine(
      (v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
      "Escribe un correo válido.",
    ),
  })
  .refine((v) => v.phone || v.email, { path: ["phone"], message: "Agrega al menos un teléfono o un correo." });

export type ContactInput = { organizationId: string; fullName: string; phone: string; email: string };

/** Posibles duplicados entre los contactos que la cuenta puede ver (RLS). Nunca fusiona. */
export async function findSimilarContacts(input: ContactInput & { excludeId?: string }): Promise<ContactSummary[]> {
  const { ctx, mismatch } = await requireWorkspace(input.organizationId);
  if (mismatch) return [];
  const { data, error } = await ctx.supabase.rpc("find_similar_contacts", {
    p_organization_id: ctx.workspace.id,
    p_full_name: input.fullName ?? "",
    p_phone: input.phone || null,
    p_email: input.email || null,
  });
  if (error) {
    logError("find_similar_contacts", error);
    return [];
  }
  return (data ?? []).filter((c) => c.id !== input.excludeId).map(({ id, full_name, phone, email }) => ({ id, full_name, phone, email }));
}

export async function createContact(input: ContactInput): Promise<ActionResult<ContactSummary>> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los datos del contacto.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase
    .from("contacts")
    .insert({ organization_id: ctx.workspace.id, full_name: v.fullName, phone: v.phone, email: v.email })
    .select("id, full_name, phone, email")
    .single();
  if (error || !data) {
    logError("create_contact", error);
    return fail(errorMessage(error));
  }
  revalidatePath("/pacientes");
  return ok(data, "Contacto registrado.");
}

export async function updateContact(input: ContactInput & { id: string }): Promise<ActionResult<ContactSummary>> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los datos del contacto.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  if (!z.uuid().safeParse(input.id).success) return fail("Contacto no encontrado.");
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase
    .from("contacts")
    .update({ full_name: v.fullName, phone: v.phone, email: v.email })
    .eq("id", input.id)
    .select("id, full_name, phone, email");
  if (error || !data?.length) {
    logError("update_contact", error);
    return fail(error ? errorMessage(error) : "No tienes permiso para editar este contacto.");
  }
  revalidatePath("/", "layout");
  return ok(data[0], "Contacto actualizado.");
}
