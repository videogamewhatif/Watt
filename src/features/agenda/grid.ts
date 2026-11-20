// Geometría del calendario (sin React): qué celdas están disponibles, fuera de
// horario o bloqueadas, y cómo acomodar citas que se traslapan.
import { isoWeekday, type LocalDate, minutesOf } from "@/lib/tz";

export type Rule = { professional_id: string; weekday: number; start_time: string; end_time: string };
export type Interval = { start: number; end: number };
export type LocalRange = { local_start: string; local_end: string };

/** Recorta un rango local (YYYY-MM-DDTHH:MM) al día indicado, en minutos desde medianoche. */
export function clipToDay(range: LocalRange, day: LocalDate): Interval | null {
  const dayStart = `${day}T00:00`;
  const nextDay = new Date(`${day}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dayEnd = `${nextDay.toISOString().slice(0, 10)}T00:00`;
  if (range.local_end <= dayStart || range.local_start >= dayEnd) return null;
  const start = range.local_start <= dayStart ? 0 : minutesOf(range.local_start.slice(11));
  const end = range.local_end >= dayEnd ? 24 * 60 : minutesOf(range.local_end.slice(11));
  return end > start ? { start, end } : null;
}

/** Bloques de atención de un profesional para un día (horas locales). */
export function workingIntervals(rules: Rule[], professionalId: string, day: LocalDate): Interval[] {
  const weekday = isoWeekday(day);
  return rules
    .filter((r) => r.professional_id === professionalId && r.weekday === weekday)
    .map((r) => ({ start: minutesOf(r.start_time), end: r.end_time.startsWith("24") ? 1440 : minutesOf(r.end_time) }))
    .sort((a, b) => a.start - b.start);
}

export type CellState = "available" | "busy" | "off" | "blocked" | "past";

/**
 * Estado de la celda [start, start + step) de un profesional.
 * Disponible solo si la celda completa cae en un bloque de atención, sin bloqueo,
 * sin cita vigente y en el futuro.
 */
export function cellState(
  start: number,
  step: number,
  working: Interval[],
  blocks: Interval[],
  nowMinutes: number | null,
  busy: Interval[] = [],
): CellState {
  const end = start + step;
  if (blocks.some((b) => b.start < end && b.end > start)) return "blocked";
  if (!working.some((w) => w.start <= start && w.end >= end)) return "off";
  if (busy.some((b) => b.start < end && b.end > start)) return "busy";
  if (nowMinutes !== null && start < nowMinutes) return "past";
  return "available";
}

/** Rango visible de horas: cubre horarios, citas y bloqueos, redondeado a horas completas. */
export function visibleBounds(intervals: Interval[], fallback: Interval = { start: 8 * 60, end: 19 * 60 }): Interval {
  if (intervals.length === 0) return fallback;
  const start = Math.min(...intervals.map((i) => i.start));
  const end = Math.max(...intervals.map((i) => i.end));
  return { start: Math.max(0, Math.floor(start / 60) * 60), end: Math.min(1440, Math.ceil(end / 60) * 60) };
}

export type Placed<T> = T & { lane: number; lanes: number };

/** Acomoda eventos traslapados en carriles lado a lado. */
export function layoutLanes<T extends Interval>(events: T[]): Placed<T>[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = laneEnds.length;
    for (const e of cluster) e.lanes = lanes;
    result.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const event of sorted) {
    if (cluster.length && event.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= event.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(event.end);
    } else {
      laneEnds[lane] = event.end;
    }
    cluster.push({ ...event, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd, event.end);
  }
  if (cluster.length) flush();
  return result;
}
