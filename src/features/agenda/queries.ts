import "server-only";
import type { AgendaAppointment, AgendaTimeOff, AvailabilityRuleRow, ServiceRow } from "@/lib/database.types";
import { logError } from "@/lib/errors";
import type { PracticeKey } from "@/lib/practice";
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

/** Profesionales visibles (RLS) con sus servicios. */
export async function loadProfessionals(ctx: AppContext): Promise<{ rows: AgendaProfessional[]; failed: boolean }> {
  const [{ data: professionals, error: e1 }, { data: links, error: e2 }] = await Promise.all([
    ctx.supabase
      .from("professionals")
      .select("id, display_name, color, professional_type, specialty, active")
      .eq("organization_id", ctx.workspace.id)
      .order("display_name"),
    ctx.supabase.from("professional_services").select("professional_id, service_id").eq("organization_id", ctx.workspace.id),
  ]);
  for (const e of [e1, e2]) if (e) logError("load_professionals", e);
  const rows = (professionals ?? []).map((p) => ({
    ...p,
    service_ids: (links ?? []).filter((l) => l.professional_id === p.id).map((l) => l.service_id),
  }));
  return { rows, failed: Boolean(e1 || e2) };
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

/**
 * Carga la agenda. Con `area` (Hospital, Dentista, …) solo incluye a los
 * profesionales de ese tipo, sus citas, bloqueos y servicios. El rol
 * Profesional siempre ve su propia agenda, sin importar el área elegida.
 */
export async function loadAgenda(ctx: AppContext, query: AgendaQuery, area: PracticeKey | null = null): Promise<AgendaData> {
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

  const filterArea = area && ctx.can.allAppointments;
  const areaProfessionals = filterArea ? professionals.rows.filter((p) => p.professional_type === area) : professionals.rows;
  const inArea = new Set(areaProfessionals.map((p) => p.id));
  const areaServiceIds = new Set(areaProfessionals.flatMap((p) => p.service_ids));
  const keep = <T extends { professional_id: string }>(rows: T[] | null) => (filterArea ? (rows ?? []).filter((r) => inArea.has(r.professional_id)) : (rows ?? []));

  const now = localParts(new Date(), tz);
  return {
    organizationId: orgId,
    timezone: tz,
    slotInterval: ctx.workspace.slotInterval,
    today: todayIn(tz),
    nowMinutes: now.minutes,
    days: eachDay(from, to),
    professionals: areaProfessionals,
    services: filterArea ? services.rows.filter((s) => areaServiceIds.has(s.id)) : services.rows,
    rules: keep(rules.data),
    timeOff: keep(blocks.data),
    appointments: keep(appts.data),
    // Cualquier fallo se muestra como error recuperable, no como agenda vacía.
    error: Boolean(appts.error || blocks.error || rules.error || professionals.failed || services.failed),
  };
}
