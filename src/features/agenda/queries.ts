import "server-only";
import type { AgendaAppointment, AgendaTimeOff, AvailabilityRuleRow, ServiceRow } from "@/lib/database.types";
import { logError } from "@/lib/errors";
import type { AppContext } from "@/lib/session";
import { eachDay, localParts, todayIn } from "@/lib/tz";
import { type AgendaQuery, agendaRange } from "./params";

export type AgendaProfessional = {
  id: string;
  display_name: string;
  color: string;
  professional_type: string;
  specialty: string | null;
  active: boolean;
  uses_pet_name: boolean;
  service_ids: string[];
};

export type AgendaService = Pick<ServiceRow, "id" | "name" | "duration_minutes" | "active">;

export type AgendaData = {
  organizationId: string;
  timezone: string;
  slotInterval: number;
  today: string;
  nowMinutes: number;
  days: string[];
  professionals: AgendaProfessional[];
  services: AgendaService[];
  rules: Pick<AvailabilityRuleRow, "professional_id" | "weekday" | "start_time" | "end_time">[];
  timeOff: AgendaTimeOff[];
  appointments: AgendaAppointment[];
  error: boolean;
};

/** Profesionales visibles (RLS) con sus servicios y si usan nombre de mascota. */
export async function loadProfessionals(ctx: AppContext): Promise<{ rows: AgendaProfessional[]; failed: boolean }> {
  const [{ data: professionals, error: e1 }, { data: links, error: e2 }, { data: types, error: e3 }] = await Promise.all([
    ctx.supabase
      .from("professionals")
      .select("id, display_name, color, professional_type, specialty, active")
      .eq("organization_id", ctx.workspace.id)
      .order("display_name"),
    ctx.supabase.from("professional_services").select("professional_id, service_id").eq("organization_id", ctx.workspace.id),
    ctx.supabase.from("professional_types").select("code, uses_pet_name"),
  ]);
  const petTypes = new Set((types ?? []).filter((t) => t.uses_pet_name).map((t) => t.code));
  for (const e of [e1, e2, e3]) if (e) logError("load_professionals", e);
  const rows = (professionals ?? []).map((p) => ({
    ...p,
    uses_pet_name: petTypes.has(p.professional_type),
    service_ids: (links ?? []).filter((l) => l.professional_id === p.id).map((l) => l.service_id),
  }));
  return { rows, failed: Boolean(e1 || e2 || e3) };
}

export async function loadServices(ctx: AppContext): Promise<{ rows: AgendaService[]; failed: boolean }> {
  const { data, error } = await ctx.supabase
    .from("services")
    .select("id, name, duration_minutes, active")
    .eq("organization_id", ctx.workspace.id)
    .order("name");
  if (error) logError("load_services", error);
  return { rows: data ?? [], failed: Boolean(error) };
}

export async function loadAgenda(ctx: AppContext, query: AgendaQuery): Promise<AgendaData> {
  const { from, to } = agendaRange(query);
  const tz = ctx.workspace.timezone;
  const orgId = ctx.workspace.id;
  // El rol Profesional solo ve su agenda: RLS ya lo garantiza; el filtro evita
  // mostrar columnas vacías si además tiene acceso por otro motivo.
  const professionalFilter = ctx.can.allAppointments ? query.professionalId : ctx.ownProfessionalId;

  const [professionals, services, appts, blocks, rules] = await Promise.all([
    loadProfessionals(ctx),
    loadServices(ctx),
    ctx.supabase.rpc("agenda_appointments", {
      p_organization_id: orgId,
      p_from: from,
      p_to: to,
      p_professional_id: professionalFilter,
      p_service_id: query.serviceId,
      p_statuses: query.status ? [query.status] : null,
    }),
    ctx.supabase.rpc("agenda_time_off", { p_organization_id: orgId, p_from: from, p_to: to, p_professional_id: professionalFilter }),
    ctx.supabase.from("availability_rules").select("professional_id, weekday, start_time, end_time").eq("organization_id", orgId),
  ]);

  if (appts.error) logError("agenda_appointments", appts.error);
  if (blocks.error) logError("agenda_time_off", blocks.error);
  if (rules.error) logError("availability_rules", rules.error);

  const now = localParts(new Date(), tz);
  return {
    organizationId: orgId,
    timezone: tz,
    slotInterval: ctx.workspace.slotInterval,
    today: todayIn(tz),
    nowMinutes: now.minutes,
    days: eachDay(from, to),
    professionals: professionals.rows,
    services: services.rows,
    rules: rules.data ?? [],
    timeOff: blocks.data ?? [],
    appointments: appts.data ?? [],
    // Cualquier fallo se muestra como error recuperable, no como agenda vacía.
    error: Boolean(appts.error || blocks.error || rules.error || professionals.failed || services.failed),
  };
}
