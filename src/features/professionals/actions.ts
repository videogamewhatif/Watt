"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import type { TimeOffKind } from "@/lib/database.types";
import { errorCode, errorMessage, logError } from "@/lib/errors";
import { requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";
import { addDays, isLocalDate, isTime, minutesOf, zonedToInstant } from "@/lib/tz";

const uuid = z.uuid();
const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v || null);

const professionalSchema = z.object({
  organizationId: uuid,
  id: uuid.nullish(),
  displayName: z.string().trim().min(2, "Escribe el nombre.").max(120, "El nombre es demasiado largo."),
  professionalType: z.string().min(2, "Elige el tipo de profesional."),
  specialty: optional(120, "La especialidad es demasiado larga."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Elige un color."),
  email: optional(160, "El correo es demasiado largo.").refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Escribe un correo válido."),
  phone: optional(30, "El teléfono es demasiado largo.").refine((v) => v === null || v.replace(/\D/g, "").length >= 7, "Escribe al menos 7 dígitos."),
});

export async function saveProfessional(input: z.input<typeof professionalSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = professionalSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const values = {
    display_name: v.displayName,
    professional_type: v.professionalType,
    specialty: v.specialty,
    color: v.color,
    email: v.email,
    phone: v.phone,
  };
  const query = v.id
    ? ctx.supabase.from("professionals").update(values).eq("id", v.id).select("id")
    : ctx.supabase.from("professionals").insert({ ...values, organization_id: ctx.workspace.id }).select("id");
  const { data, error } = await query;
  if (error || !data?.length) {
    logError("save_professional", error);
    return fail(error ? errorMessage(error) : "No tienes permiso para editar este profesional.");
  }
  revalidatePath("/", "layout");
  return ok({ id: data[0].id }, "Profesional guardado.");
}

export async function futureAppointmentsCount(organizationId: string, professionalId: string): Promise<number> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return 0;
  const { data } = await ctx.supabase.rpc("professional_future_appointments", { p_professional_id: professionalId });
  return data ?? 0;
}

/** Desactivar conserva el historial e impide nuevas reservas. Nunca cancela citas. */
export async function setProfessionalActive(organizationId: string, professionalId: string, active: boolean): Promise<ActionResult<{ future: number }>> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase.from("professionals").update({ active }).eq("id", professionalId).select("id");
  if (error || !data?.length) {
    logError("set_professional_active", error);
    return fail(error ? errorMessage(error) : "No tienes permiso para cambiar este profesional.");
  }
  const future = await futureAppointmentsCount(organizationId, professionalId);
  revalidatePath("/", "layout");
  return ok({ future }, active ? "Profesional reactivado." : "Profesional desactivado. Ya no recibe nuevas citas.");
}

export async function setProfessionalServices(organizationId: string, professionalId: string, serviceIds: string[]): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  if (!uuid.safeParse(professionalId).success || serviceIds.some((s) => !uuid.safeParse(s).success)) return fail("Datos inválidos.");
  const { data: current, error: readError } = await ctx.supabase.from("professional_services").select("service_id").eq("professional_id", professionalId);
  if (readError) return fail(errorMessage(readError));
  const have = new Set((current ?? []).map((r) => r.service_id));
  const want = new Set(serviceIds);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));
  if (toAdd.length) {
    const { error } = await ctx.supabase
      .from("professional_services")
      .insert(toAdd.map((service_id) => ({ organization_id: ctx.workspace.id, professional_id: professionalId, service_id })));
    if (error) {
      logError("add_professional_services", error);
      return fail(errorMessage(error));
    }
  }
  if (toRemove.length) {
    const { error } = await ctx.supabase.from("professional_services").delete().eq("professional_id", professionalId).in("service_id", toRemove);
    if (error) {
      logError("remove_professional_services", error);
      return fail(errorMessage(error));
    }
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Servicios actualizados.");
}

const ruleSchema = z.object({ weekday: z.number().int().min(1).max(7), start_time: z.string().refine(isTime), end_time: z.string() });

export type ScheduleRuleInput = z.infer<typeof ruleSchema>;

export async function saveWeeklySchedule(organizationId: string, professionalId: string, rules: ScheduleRuleInput[]): Promise<ActionResult<{ outside: number }>> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const parsed = z.array(ruleSchema).max(70).safeParse(rules);
  if (!parsed.success) return fail("Revisa los horarios: hay horas inválidas.");
  for (const r of parsed.data) {
    if (!(r.end_time === "24:00" || isTime(r.end_time)) || (r.end_time !== "24:00" && minutesOf(r.end_time) <= minutesOf(r.start_time))) {
      return fail("Cada bloque debe terminar después de empezar.");
    }
  }
  const { data, error } = await ctx.supabase.rpc("set_weekly_schedule", { p_professional_id: professionalId, p_rules: parsed.data });
  if (error) {
    logError("set_weekly_schedule", error);
    return fail(errorMessage(error));
  }
  revalidatePath("/", "layout");
  return ok({ outside: data ?? 0 }, "Horario guardado.");
}

const timeOffSchema = z
  .object({
    organizationId: uuid,
    professionalId: uuid,
    fromDate: z.string().refine(isLocalDate, "Elige la fecha de inicio."),
    fromTime: z.string(),
    toDate: z.string().refine(isLocalDate, "Elige la fecha de fin."),
    toTime: z.string(),
    allDay: z.boolean(),
    kind: z.enum(["vacation", "meal", "absence", "other"]),
    note: z.string().trim().max(200, "Máximo 200 caracteres."),
  })
  .superRefine((v, ctx) => {
    if (!v.allDay && !isTime(v.fromTime)) ctx.addIssue({ code: "custom", path: ["fromTime"], message: "Elige la hora de inicio." });
    if (!v.allDay && !isTime(v.toTime)) ctx.addIssue({ code: "custom", path: ["toTime"], message: "Elige la hora de fin." });
  });

export async function createTimeOff(input: z.input<typeof timeOffSchema>): Promise<ActionResult> {
  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const tz = ctx.workspace.timezone;
  // Las horas que captura la administración son horas locales del espacio.
  const startsAt = zonedToInstant(v.fromDate, v.allDay ? "00:00" : v.fromTime, tz);
  const endsAt = v.allDay ? zonedToInstant(addDays(v.toDate, 1), "00:00", tz) : zonedToInstant(v.toDate, v.toTime, tz);
  if (endsAt <= startsAt) return fail("El bloqueo debe terminar después de empezar.", { fieldErrors: { toTime: "Debe ser posterior al inicio." } });

  const { error } = await ctx.supabase.from("time_off").insert({
    organization_id: ctx.workspace.id,
    professional_id: v.professionalId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    kind: v.kind as TimeOffKind,
    note: v.note || null,
  });
  if (error) {
    const code = errorCode(error);
    if (code === "time_off_conflict") {
      const count = Number(error.details) || 0;
      return fail(
        `Hay ${count === 1 ? "1 cita vigente" : `${count} citas vigentes`} en ese periodo. Reprográmalas o cancélalas antes de crear el bloqueo.`,
        { code },
      );
    }
    logError("create_time_off", error);
    return fail(errorMessage(error), { code });
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Bloqueo creado.");
}

export async function deleteTimeOff(organizationId: string, id: string): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase.from("time_off").delete().eq("id", id).select("id");
  if (error || !data?.length) {
    logError("delete_time_off", error);
    return fail(error ? errorMessage(error) : "No tienes permiso para quitar este bloqueo.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Bloqueo eliminado.");
}

/** Vincula (o desvincula) la cuenta de un miembro del espacio con un perfil profesional. */
export async function linkProfessionalAccount(organizationId: string, professionalId: string, userId: string | null): Promise<ActionResult> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH);
  const { data, error } = await ctx.supabase.from("professionals").update({ user_id: userId }).eq("id", professionalId).select("id");
  if (error || !data?.length) {
    logError("link_professional_account", error);
    const code = errorCode(error);
    if (code === "duplicate") return fail("Esa cuenta ya está vinculada a otro perfil profesional de este espacio.");
    return fail(error ? errorMessage(error) : "No tienes permiso para cambiar este profesional.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, userId ? "Cuenta vinculada." : "Cuenta desvinculada.");
}
