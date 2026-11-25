"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import { errorMessage, logError } from "@/lib/errors";
import { MAX_AMOUNT, toCents } from "@/lib/money";
import { requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";

const serviceSchema = z.object({
  organizationId: z.uuid(),
  id: z.uuid().nullish(),
  name: z.string().trim().min(2, "Escribe el nombre del servicio.").max(120, "El nombre es demasiado largo."),
  durationMinutes: z.coerce.number({ error: "Escribe la duración." }).int("Usa minutos enteros.").min(5, "Mínimo 5 minutos.").max(720, "Máximo 12 horas."),
  price: z.coerce
    .number({ error: "Escribe el precio." })
    .min(0, "El precio no puede ser negativo.")
    .max(MAX_AMOUNT, "El precio es demasiado alto.")
    .refine((n) => Math.abs(n * 100 - toCents(n)) < 1e-6, "Usa máximo dos decimales."),
  description: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres.")
    .transform((v) => v || null),
  active: z.boolean(),
  professionalIds: z.array(z.uuid()),
});

export async function saveService(input: z.input<typeof serviceSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);

  const values = { name: v.name, duration_minutes: v.durationMinutes, price: v.price, description: v.description, active: v.active };
  const { data, error } = v.id
    ? await ctx.supabase.from("services").update(values).eq("id", v.id).select("id")
    : await ctx.supabase.from("services").insert({ ...values, organization_id: ctx.workspace.id }).select("id");
  if (error || !data?.length) {
    logError("save_service", error);
    return fail(error ? errorMessage(error) : "No tienes permiso para editar este servicio.");
  }
  const serviceId = data[0].id;

  // Asignación a profesionales: se agregan y quitan solo las diferencias.
  const { data: current } = await ctx.supabase.from("professional_services").select("professional_id").eq("service_id", serviceId);
  const have = new Set((current ?? []).map((r) => r.professional_id));
  const want = new Set(v.professionalIds);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));
  if (toAdd.length) {
    const { error: addError } = await ctx.supabase
      .from("professional_services")
      .insert(toAdd.map((professional_id) => ({ organization_id: ctx.workspace.id, professional_id, service_id: serviceId })));
    if (addError) {
      logError("assign_service", addError);
      return fail(`El servicio se guardó, pero no se pudo asignar: ${errorMessage(addError)}`);
    }
  }
  if (toRemove.length) {
    const { error: removeError } = await ctx.supabase.from("professional_services").delete().eq("service_id", serviceId).in("professional_id", toRemove);
    if (removeError) {
      logError("unassign_service", removeError);
      return fail(`El servicio se guardó, pero no se pudo actualizar la asignación: ${errorMessage(removeError)}`);
    }
  }
  revalidatePath("/", "layout");
  return ok({ id: serviceId }, v.id ? "Servicio actualizado. Las citas ya registradas conservan su hora final." : "Servicio creado.");
}
