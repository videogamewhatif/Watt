// Filtros de los reportes en la URL: periodo (preestablecido o fechas), área de
// atención y profesional. Todas las fechas son locales del espacio ("YYYY-MM-DD").
import { isPracticeKey, type PracticeKey } from "@/lib/practice";
import { addDays, isLocalDate, type LocalDate, startOfWeek } from "@/lib/tz";

/** Un reporte abarca como máximo un año (366 días). */
export const MAX_DAYS = 366;

export const PRESETS = [
  { key: "hoy", label: "Hoy" },
  { key: "ayer", label: "Ayer" },
  { key: "semana", label: "Esta semana" },
  { key: "semana-pasada", label: "Semana pasada" },
  { key: "mes", label: "Este mes" },
  { key: "mes-pasado", label: "Mes pasado" },
  { key: "30-dias", label: "Últimos 30 días" },
  { key: "anio", label: "Este año" },
] as const;

export type PresetKey = (typeof PRESETS)[number]["key"];

export const DEFAULT_PRESET: PresetKey = "mes";

export type ReportFilters = {
  from: LocalDate;
  to: LocalDate;
  /** Preestablecido que coincide con el rango (para marcarlo), si lo hay. */
  preset: PresetKey | null;
  area: PracticeKey | null;
  professionalId: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const monthStart = (date: LocalDate) => `${date.slice(0, 8)}01`;

export function isPresetKey(value: unknown): value is PresetKey {
  return PRESETS.some((p) => p.key === value);
}

export function presetRange(key: PresetKey, today: LocalDate): { from: LocalDate; to: LocalDate } {
  switch (key) {
    case "hoy":
      return { from: today, to: today };
    case "ayer":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "semana":
      return { from: startOfWeek(today), to: today };
    case "semana-pasada": {
      const from = addDays(startOfWeek(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case "mes":
      return { from: monthStart(today), to: today };
    case "mes-pasado": {
      const to = addDays(monthStart(today), -1);
      return { from: monthStart(to), to };
    }
    case "30-dias":
      return { from: addDays(today, -29), to: today };
    case "anio":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Días del rango, ambos incluidos. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Lee los filtros de la URL. Un periodo preestablecido (`periodo=mes`) se
 * resuelve con la fecha de hoy del espacio; si no, se usan `desde`/`hasta`.
 * Un rango invertido se corrige y uno mayor a un año se recorta desde `hasta`.
 */
export function parseReportFilters(params: RawParams, today: LocalDate): ReportFilters {
  const periodo = first(params.periodo);
  const desde = first(params.desde);
  const hasta = first(params.hasta);
  let range: { from: LocalDate; to: LocalDate };
  if (isPresetKey(periodo)) range = presetRange(periodo, today);
  else if (isLocalDate(desde) || isLocalDate(hasta)) {
    const from = isLocalDate(desde) ? desde : isLocalDate(hasta) ? hasta : today;
    const to = isLocalDate(hasta) ? hasta : from > today ? from : today;
    range = from <= to ? { from, to } : { from: to, to: from };
  } else range = presetRange(DEFAULT_PRESET, today);

  if (daysBetween(range.from, range.to) > MAX_DAYS) range = { from: addDays(range.to, -(MAX_DAYS - 1)), to: range.to };

  const area = first(params.area);
  const professional = first(params.profesional);
  return {
    ...range,
    preset: PRESETS.find((p) => {
      const r = presetRange(p.key, today);
      return r.from === range.from && r.to === range.to;
    })?.key ?? null,
    area: isPracticeKey(area) ? area : null,
    professionalId: professional && UUID_RE.test(professional) ? professional : null,
  };
}

/** Parámetros de búsqueda que reproducen los filtros (sin el preestablecido). */
export function filterParams(filters: Pick<ReportFilters, "from" | "to" | "area" | "professionalId">): URLSearchParams {
  const sp = new URLSearchParams({ desde: filters.from, hasta: filters.to });
  if (filters.area) sp.set("area", filters.area);
  if (filters.professionalId) sp.set("profesional", filters.professionalId);
  return sp;
}

export function reportHref(key: string, filters: Pick<ReportFilters, "from" | "to" | "area" | "professionalId">): string {
  return `/reportes/${key}?${filterParams(filters)}`;
}

/** Enlace a un preestablecido conservando área y profesional. */
export function presetHref(key: string, preset: PresetKey, filters: Pick<ReportFilters, "area" | "professionalId">): string {
  const sp = new URLSearchParams({ periodo: preset });
  if (filters.area) sp.set("area", filters.area);
  if (filters.professionalId) sp.set("profesional", filters.professionalId);
  return `/reportes/${key}?${sp}`;
}

export function csvHref(key: string, tableId: string, filters: Pick<ReportFilters, "from" | "to" | "area" | "professionalId">): string {
  const sp = filterParams(filters);
  sp.set("tabla", tableId);
  return `/reportes/${key}/csv?${sp}`;
}

// ---------------------------------------------------------------------------
// Agrupación en el tiempo: por día hasta un mes, por semana hasta un trimestre
// y por mes en rangos más largos (así una gráfica nunca tiene cientos de barras).
// ---------------------------------------------------------------------------
export type Granularity = "day" | "week" | "month";

export function granularityFor(from: LocalDate, to: LocalDate): Granularity {
  const days = daysBetween(from, to);
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
}

/** Clave del grupo al que pertenece una fecha: el día, el lunes de su semana o el día 1 del mes. */
export function bucketOf(date: LocalDate, granularity: Granularity): LocalDate {
  if (granularity === "day") return date;
  if (granularity === "week") return startOfWeek(date);
  return monthStart(date);
}

/** Todos los grupos del rango, en orden, aunque no tengan datos. */
export function bucketsBetween(from: LocalDate, to: LocalDate, granularity: Granularity): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = bucketOf(from, granularity); d <= to; ) {
    out.push(d);
    if (granularity === "day") d = addDays(d, 1);
    else if (granularity === "week") d = addDays(d, 7);
    else d = monthStart(addDays(d, 32));
  }
  return out;
}

const UTC = "UTC";
const dayMonth = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: UTC });
const dayMonthYear = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: UTC });
const dayLong = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: UTC });
const monthShort = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric", timeZone: UTC });
const asDate = (date: LocalDate) => new Date(`${date}T00:00:00Z`);

/** Etiqueta corta de un grupo: "3 nov", "sem. 3 nov", "nov 2026". */
export function bucketLabel(bucket: LocalDate, granularity: Granularity): string {
  if (granularity === "day") return dayMonth.format(asDate(bucket));
  if (granularity === "week") return `sem. ${dayMonth.format(asDate(bucket))}`;
  return monthShort.format(asDate(bucket));
}

export const GRANULARITY_LABEL: Record<Granularity, string> = { day: "Por día", week: "Por semana", month: "Por mes" };

/** "21 de noviembre de 2026", "1 – 21 de noviembre de 2026", "15 de diciembre de 2025 – 10 de enero de 2026". */
export function periodLabel(from: LocalDate, to: LocalDate): string {
  if (from === to) return dayMonthYear.format(asDate(from));
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${dayMonthYear.format(asDate(from))} – ${dayMonthYear.format(asDate(to))}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))} – ${dayMonthYear.format(asDate(to))}`;
  return `${dayLong.format(asDate(from))} – ${dayMonthYear.format(asDate(to))}`;
}

/**
 * Filtros que aplican a un reporte: se ignoran el área si el reporte no la usa o
 * no existe en el espacio, y el profesional si el reporte no lo usa.
 */
export function effectiveFilters(
  filters: ReportFilters,
  def: { filters: { area: boolean; professional: boolean } },
  areaKeys: readonly string[],
): ReportFilters {
  return {
    ...filters,
    area: def.filters.area && filters.area && areaKeys.includes(filters.area) ? filters.area : null,
    professionalId: def.filters.professional ? filters.professionalId : null,
  };
}
