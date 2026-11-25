"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import type { AgendaAppointment, AppointmentEventType, AppointmentStatus, ContactRow } from "@/lib/database.types";
import { errorCode, errorMessage, logError, SLOT_ERRORS } from "@/lib/errors";
import { featureError } from "@/features/billing/server";
import { requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";
import { addDays, isLocalDate, isTime, localParts } from "@/lib/tz";

const uuid = z.uuid("Identificador inválido.");
const localDate = z.string().refine(isLocalDate, "Elige una fecha válida.");
const localTime = z.string().refine(isTime, "Elige una hora válida.");

export type Slot = { date: string; time: string };
export type ContactOption = Pick<ContactRow, "id" | "full_name" | "phone" | "email">;

function toSlots(rows: { local_start: string }[] | null): Slot[] {
  return (rows ?? []).map((r) => ({ date: r.local_start.slice(0, 10), time: r.local_start.slice(11, 16) }));
}

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------
const slotsSchema = z.object({
  organizationId: uuid,
  professionalId: uuid,
  serviceId: uuid,
  date: localDate,
  days: z.number().int().min(1).max(31).default(1),
  excludeAppointmentId: uuid.nullish(),
});

export async function fetchSlots(input: z.input<typeof slotsSchema>): Promise<ActionResult<Slot[]>> {
  const parsed = slotsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos incompletos para consultar horarios.");
  const { ctx, mismatch } = await requireWorkspace(parsed.data.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase.rpc("get_available_slots", {
    p_professional_id: parsed.data.professionalId,
    p_service_id: parsed.data.serviceId,
    p_from: parsed.data.date,
    p_days: parsed.data.days,
    p_exclude_appointment_id: parsed.data.excludeAppointmentId ?? null,
  });
  if (error) {
    logError("get_available_slots", error);
    return fail(errorMessage(error, "No pudimos consultar los horarios disponibles."));
  }
  return ok(toSlots(data));
}

/** Siguientes horarios libres a partir de una fecha (busca hasta 8 semanas). */
export async function findNextSlots(input: z.input<typeof slotsSchema> & { limit?: number }): Promise<ActionResult<Slot[]>> {
  const limit = input.limit ?? 6;
  let date = input.date;
  const found: Slot[] = [];
  for (let i = 0; i < 4 && found.length < limit; i++) {
    const result = await fetchSlots({ ...input, date, days: 14 });
    if (!result.ok) return result;
    found.push(...result.data);
    date = addDays(date, 14);
  }
  return ok(found.slice(0, limit));
}

// ---------------------------------------------------------------------------
// Contactos dentro del flujo de agenda
// ---------------------------------------------------------------------------
export async function searchContacts(organizationId: string, query: string): Promise<ActionResult<ContactOption[]>> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase.rpc("search_contacts", { p_organization_id: ctx.workspace.id, p_query: query.slice(0, 80), p_limit: 8 });
  if (error) {
    logError("search_contacts", error);
    return fail("No pudimos buscar pacientes.");
  }
  return ok((data ?? []).map(({ id, full_name, phone, email }) => ({ id, full_name, phone, email })));
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------
const createSchema = z.object({
  organizationId: uuid,
  professionalId: z.uuid("Elige un profesional."),
  serviceId: z.uuid("Elige un servicio."),
  contactId: z.uuid("Elige o registra al paciente."),
  date: localDate,
  time: localTime,
  status: z.enum(["pending", "confirmed"]),
  notes: z.string().trim().max(500, "Máximo 500 caracteres.").optional(),
  idempotencyKey: uuid,
});

export type CreateAppointmentResult = { id: string; date: string; time: string };

export async function createAppointment(input: z.input<typeof createSchema>): Promise<ActionResult<CreateAppointmentResult>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  // Suscripción en modo de consulta (impago, cancelada o vencida): no se agendan citas nuevas.
  const blocked = await featureError("module.agenda", { write: true });
  if (blocked) return fail(blocked, { code: "subscription_read_only" });

  // La base valida disponibilidad, permisos y traslapes; calcula la hora final.
  const { data, error } = await ctx.supabase
    .rpc("book_appointment", {
      p_professional_id: v.professionalId,
      p_service_id: v.serviceId,
      p_contact_id: v.contactId,
      p_local_date: v.date,
      p_local_time: v.time,
      p_status: v.status,
      p_notes: v.notes || null,
      p_idempotency_key: v.idempotencyKey,
    });
  if (error || !data) {
    const code = errorCode(error);
    if (!SLOT_ERRORS.has(code)) logError("book_appointment", error);
    return fail(errorMessage(error), { code, fieldErrors: SLOT_ERRORS.has(code) ? { time: errorMessage(error) } : undefined });
  }
  revalidatePath("/", "layout");
  const local = localParts(data.starts_at, ctx.workspace.timezone);
  return ok({ id: data.id, date: local.date, time: local.time });
}

const rescheduleSchema = z.object({
  organizationId: uuid,
  appointmentId: uuid,
  date: localDate,
  time: localTime,
  professionalId: uuid.nullish(),
});

export async function rescheduleAppointment(input: z.input<typeof rescheduleSchema>): Promise<ActionResult<CreateAppointmentResult>> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase
    .rpc("reschedule_appointment", {
      p_appointment_id: v.appointmentId,
      p_local_date: v.date,
      p_local_time: v.time,
      p_professional_id: v.professionalId ?? null,
    });
  if (error || !data) {
    const code = errorCode(error);
    if (!SLOT_ERRORS.has(code)) logError("reschedule_appointment", error);
    // La transacción se revierte: la cita conserva su horario original.
    return fail(`${errorMessage(error)} La cita conserva su horario original.`, { code });
  }
  revalidatePath("/", "layout");
  const local = localParts(data.starts_at, ctx.workspace.timezone);
  return ok({ id: data.id, date: local.date, time: local.time });
}

const statusSchema = z.object({
  organizationId: uuid,
  appointmentId: uuid,
  status: z.enum(["pending", "confirmed", "attended", "cancelled", "no_show"]),
  reason: z.string().trim().max(200, "Máximo 200 caracteres.").optional(),
});

export async function setAppointmentStatus(input: z.input<typeof statusSchema>): Promise<ActionResult<{ status: AppointmentStatus }>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los datos.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase
    .rpc("set_appointment_status", { p_appointment_id: v.appointmentId, p_status: v.status, p_reason: v.reason || null });
  if (error || !data) {
    logError("set_appointment_status", error);
    return fail(errorMessage(error), { code: errorCode(error) });
  }
  revalidatePath("/", "layout");
  return ok({ status: data.status });
}

const detailsSchema = z.object({
  organizationId: uuid,
  appointmentId: uuid,
  notes: z.string().trim().max(500, "Máximo 500 caracteres."),
});

export async function updateAppointmentDetails(input: z.input<typeof detailsSchema>): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  const { data, error } = await ctx.supabase
    .from("appointments")
    .update({ notes: v.notes || null })
    .eq("id", v.appointmentId)
    .select("id");
  if (error || !data?.length) {
    logError("update_appointment_details", error);
    return fail(errorMessage(error ?? { code: "PGRST116" }));
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Cambios guardados.");
}

// ---------------------------------------------------------------------------
// Detalle e historial
// ---------------------------------------------------------------------------
export type HistoryEntry = {
  id: number;
  type: AppointmentEventType;
  at: string;
  actor: string;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus | null;
  fromLocal: string | null;
  toLocal: string | null;
  fromProfessional: string | null;
  toProfessional: string | null;
};

export async function getAppointment(organizationId: string, appointmentId: string): Promise<ActionResult<AgendaAppointment>> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  if (!uuid.safeParse(appointmentId).success) return fail("Cita no encontrada.");
  const { data, error } = await ctx.supabase
    .from("appointments")
    .select(
      "id, professional_id, service_id, contact_id, status, starts_at, ends_at, notes, professional:professionals(display_name, color), service:services(name), contact:contacts(full_name, phone, email)",
    )
    .eq("id", appointmentId)
    .eq("organization_id", ctx.workspace.id)
    .maybeSingle();
  if (error || !data) return fail("No encontramos la cita o no tienes acceso a ella.");
  const tz = ctx.workspace.timezone;
  const s = localParts(data.starts_at, tz);
  const e = localParts(data.ends_at, tz);
  return ok({
    id: data.id,
    professional_id: data.professional_id,
    professional_name: data.professional?.display_name ?? "",
    professional_color: data.professional?.color ?? "#0f766e",
    service_id: data.service_id,
    service_name: data.service?.name ?? "",
    contact_id: data.contact_id,
    contact_name: data.contact?.full_name ?? "",
    contact_phone: data.contact?.phone ?? null,
    contact_email: data.contact?.email ?? null,
    status: data.status,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    local_start: `${s.date}T${s.time}`,
    local_end: `${e.date}T${e.time}`,
    notes: data.notes,
  });
}

export async function getAppointmentHistory(organizationId: string, appointmentId: string): Promise<ActionResult<HistoryEntry[]>> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  if (!uuid.safeParse(appointmentId).success) return fail("Cita no encontrada.");
  const { data: events, error } = await ctx.supabase
    .from("appointment_events")
    .select("*")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    logError("appointment_events", error);
    return fail("No pudimos cargar el historial.");
  }
  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter((id): id is string => Boolean(id)))];
  const profIds = [
    ...new Set((events ?? []).flatMap((e) => [e.from_professional_id, e.to_professional_id]).filter((id): id is string => Boolean(id))),
  ];
  const [{ data: profiles }, { data: professionals }] = await Promise.all([
    actorIds.length ? ctx.supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] }),
    profIds.length ? ctx.supabase.from("professionals").select("id, display_name").in("id", profIds) : Promise.resolve({ data: [] }),
  ]);
  const actorName = (id: string | null) => {
    if (!id) return "Sistema";
    const p = profiles?.find((x) => x.id === id);
    return p?.full_name || p?.email || "Otra cuenta";
  };
  const profName = (id: string | null) => (id ? (professionals?.find((x) => x.id === id)?.display_name ?? null) : null);
  const tz = ctx.workspace.timezone;
  const local = (iso: string | null) => (iso ? (({ date, time }) => `${date}T${time}`)(localParts(iso, tz)) : null);
  return ok(
    (events ?? []).map((e) => ({
      id: e.id,
      type: e.event_type,
      at: e.created_at,
      actor: actorName(e.actor_id),
      fromStatus: e.from_status,
      toStatus: e.to_status,
      fromLocal: local(e.from_starts_at),
      toLocal: local(e.to_starts_at),
      fromProfessional: profName(e.from_professional_id),
      toProfessional: profName(e.to_professional_id),
    })),
  );
}
