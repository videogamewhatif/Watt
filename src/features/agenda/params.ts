import type { AppointmentStatus } from "@/lib/database.types";
import { addDays, isLocalDate, type LocalDate, startOfWeek } from "@/lib/tz";

export type AgendaView = "dia" | "semana" | "lista";

export type AgendaQuery = {
  date: LocalDate;
  /** null = vista automática: día en escritorio, lista del día en teléfono. */
  view: AgendaView | null;
  professionalId: string | null;
  serviceId: string | null;
  status: AppointmentStatus | null;
  appointmentId: string | null;
  openNew: boolean;
};

const VIEWS: AgendaView[] = ["dia", "semana", "lista"];
const STATUSES: AppointmentStatus[] = ["pending", "confirmed", "attended", "cancelled", "no_show"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function uuid(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

export function parseAgendaQuery(params: RawParams, today: LocalDate): AgendaQuery {
  const date = first(params.fecha);
  const view = first(params.vista) as AgendaView | undefined;
  const status = first(params.estado) as AppointmentStatus | undefined;
  return {
    date: isLocalDate(date) ? date : today,
    view: view && VIEWS.includes(view) ? view : null,
    professionalId: uuid(first(params.profesional)),
    serviceId: uuid(first(params.servicio)),
    status: status && STATUSES.includes(status) ? status : null,
    appointmentId: uuid(first(params.cita)),
    openNew: first(params.nueva) === "1",
  };
}

/** Rango de fechas que necesita la vista. La vista automática usa el día. */
export function agendaRange(query: Pick<AgendaQuery, "date" | "view">): { from: LocalDate; to: LocalDate } {
  if (query.view === "semana") {
    const from = startOfWeek(query.date);
    return { from, to: addDays(from, 6) };
  }
  return { from: query.date, to: query.date };
}

/** Paso de navegación anterior/siguiente según la vista. */
export function stepDate(query: Pick<AgendaQuery, "date" | "view">, direction: -1 | 1): LocalDate {
  return addDays(query.date, (query.view === "semana" ? 7 : 1) * direction);
}

/** Construye la URL de la agenda conservando fecha, vista y filtros. */
export function agendaHref(query: Partial<AgendaQuery>, overrides: Partial<AgendaQuery> = {}): string {
  const q = { ...query, ...overrides };
  const sp = new URLSearchParams();
  if (q.date) sp.set("fecha", q.date);
  if (q.view) sp.set("vista", q.view);
  if (q.professionalId) sp.set("profesional", q.professionalId);
  if (q.serviceId) sp.set("servicio", q.serviceId);
  if (q.status) sp.set("estado", q.status);
  if (q.appointmentId) sp.set("cita", q.appointmentId);
  if (q.openNew) sp.set("nueva", "1");
  const s = sp.toString();
  return s ? `/agenda?${s}` : "/agenda";
}
