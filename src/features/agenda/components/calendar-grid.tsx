"use client";

import { PawPrint } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { STATUS_STYLE, StatusBadge } from "@/components/ui/status-badge";
import type { AgendaAppointment, AgendaTimeOff } from "@/lib/database.types";
import { STATUS_LABEL, TIME_OFF_LABEL } from "@/lib/labels";
import { formatMediumDate, hhmm, minutesOf } from "@/lib/tz";
import { type CellState, cellState, clipToDay, type Interval, layoutLanes, type Rule, visibleBounds, workingIntervals } from "../grid";

const PX_PER_MIN = 2;

export type GridColumn = {
  key: string;
  date: string;
  /** Profesionales que se muestran en la columna. */
  professionalIds: string[];
  header: ReactNode;
  isToday: boolean;
};

type Props = {
  columns: GridColumn[];
  rules: Rule[];
  appointments: AgendaAppointment[];
  timeOff: AgendaTimeOff[];
  professionalNames: Record<string, string>;
  slotInterval: number;
  today: string;
  nowMinutes: number;
  showProfessional: boolean;
  label: string;
  onSelect: (appointment: AgendaAppointment) => void;
  onSlot: (slot: { date: string; time: string; professionalId: string | null }) => void;
};

function combineStates(states: CellState[]): CellState {
  if (states.includes("available")) return "available";
  if (states.includes("past")) return "past";
  if (states.includes("busy")) return "busy";
  if (states.includes("blocked")) return "blocked";
  return "off";
}

export function CalendarGrid(props: Props) {
  const { columns, rules, appointments, timeOff, professionalNames, slotInterval, today, nowMinutes, showProfessional, label, onSelect, onSlot } = props;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rango visible: horarios de atención, citas y bloqueos de las columnas.
  const intervals: Interval[] = [];
  for (const col of columns) {
    for (const pid of col.professionalIds) intervals.push(...workingIntervals(rules, pid, col.date));
  }
  for (const a of appointments) {
    for (const col of columns) {
      const c = clipToDay(a, col.date);
      if (c) intervals.push(c);
    }
  }
  const bounds = visibleBounds(intervals);
  const height = (bounds.end - bounds.start) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = bounds.start; m < bounds.end; m += 60) hours.push(m);

  // Solo se reposiciona al cambiar de fecha o de columnas, no en cada render (p. ej. al abrir un panel).
  const columnsKey = columns.map((c) => `${c.key}:${c.date}`).join("|");
  const hasToday = columns.some((c) => c.isToday);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = hasToday ? nowMinutes - 60 : bounds.start;
    el.scrollTop = Math.max(0, (target - bounds.start) * PX_PER_MIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowMinutes cambia con cada recarga y no debe mover la vista
  }, [columnsKey, hasToday, bounds.start]);

  return (
    <div
      ref={scrollRef}
      className="relative max-h-[calc(100dvh-15rem)] min-h-[420px] overflow-auto rounded-2xl border border-line bg-surface"
      role="region"
      aria-label={label}
      tabIndex={-1}
    >
      <div className="grid min-w-full" style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(9.5rem, 1fr))` }}>
        {/* Encabezados */}
        <div className="sticky top-0 left-0 z-30 border-r border-b border-line bg-surface" />
        {columns.map((col) => (
          <div
            key={`h-${col.key}`}
            className={`sticky top-0 z-20 border-b border-l border-line px-2 py-2 text-center text-sm ${col.isToday ? "bg-brand-50" : "bg-surface"}`}
          >
            {col.header}
          </div>
        ))}

        {/* Eje de horas */}
        <div className="sticky left-0 z-10 border-r border-line bg-surface" style={{ height }} aria-hidden>
          {hours.map((m) => (
            <div key={m} className="tabular absolute right-1.5 -translate-y-1/2 text-[11px] text-muted" style={{ top: (m - bounds.start) * PX_PER_MIN }}>
              {m === bounds.start ? "" : hhmm(m)}
            </div>
          ))}
          {columns.some((c) => c.isToday) && nowMinutes >= bounds.start && nowMinutes <= bounds.end ? (
            <div
              className="tabular absolute right-0.5 z-10 -translate-y-1/2 rounded bg-red-600 px-1 text-[10px] font-semibold text-white"
              style={{ top: (nowMinutes - bounds.start) * PX_PER_MIN }}
            >
              {hhmm(nowMinutes)}
            </div>
          ) : null}
        </div>

        {columns.map((col) => (
          <DayColumn
            key={col.key}
            column={col}
            bounds={bounds}
            height={height}
            rules={rules}
            appointments={appointments}
            timeOff={timeOff}
            professionalNames={professionalNames}
            slotInterval={slotInterval}
            nowMinutes={col.date === today ? nowMinutes : col.date < today ? 24 * 60 : null}
            showNow={col.date === today}
            showProfessional={showProfessional}
            onSelect={onSelect}
            onSlot={onSlot}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  column,
  bounds,
  height,
  rules,
  appointments,
  timeOff,
  professionalNames,
  slotInterval,
  nowMinutes,
  showNow,
  showProfessional,
  onSelect,
  onSlot,
}: {
  column: GridColumn;
  bounds: Interval;
  height: number;
  rules: Rule[];
  appointments: AgendaAppointment[];
  timeOff: AgendaTimeOff[];
  professionalNames: Record<string, string>;
  slotInterval: number;
  nowMinutes: number | null;
  showNow: boolean;
  showProfessional: boolean;
  onSelect: (a: AgendaAppointment) => void;
  onSlot: (slot: { date: string; time: string; professionalId: string | null }) => void;
}) {
  const ids = new Set(column.professionalIds);
  const blocksByProf = new Map<string, Interval[]>();
  const bands: (Interval & { block: AgendaTimeOff })[] = [];
  for (const t of timeOff) {
    if (!ids.has(t.professional_id)) continue;
    const c = clipToDay(t, column.date);
    if (!c) continue;
    blocksByProf.set(t.professional_id, [...(blocksByProf.get(t.professional_id) ?? []), c]);
    bands.push({ ...c, block: t });
  }
  const working = new Map(column.professionalIds.map((pid) => [pid, workingIntervals(rules, pid, column.date)]));
  const busyByProf = new Map<string, Interval[]>();
  for (const a of appointments) {
    if (!ids.has(a.professional_id) || (a.status !== "pending" && a.status !== "confirmed")) continue;
    const c = clipToDay(a, column.date);
    if (c) busyByProf.set(a.professional_id, [...(busyByProf.get(a.professional_id) ?? []), c]);
  }
  const single = column.professionalIds.length === 1 ? column.professionalIds[0] : null;
  const dateLabel = formatMediumDate(column.date).toLowerCase();

  const cells: { start: number; state: CellState }[] = [];
  for (let m = bounds.start; m < bounds.end; m += slotInterval) {
    const states = column.professionalIds.map((pid) => cellState(m, slotInterval, working.get(pid) ?? [], blocksByProf.get(pid) ?? [], nowMinutes, busyByProf.get(pid) ?? []),
    );
    cells.push({ start: m, state: states.length ? combineStates(states) : "off" });
  }

  const events = layoutLanes(
    appointments
      .filter((a) => ids.has(a.professional_id))
      .flatMap((a) => {
        const c = clipToDay(a, column.date);
        return c ? [{ ...c, appointment: a }] : [];
      }),
  );

  return (
    <div className="relative border-l border-line" style={{ height }}>
      {cells.map(({ start, state }) => {
        const top = (start - bounds.start) * PX_PER_MIN;
        const h = slotInterval * PX_PER_MIN;
        const hourLine = start % 60 === 0 ? "border-t border-line" : "border-t border-line/40 border-dashed";
        if (state === "available") {
          const who = single ? ` con ${professionalNames[single] ?? "el profesional"}` : "";
          return (
            <button
              key={start}
              type="button"
              className={`group absolute inset-x-0 ${hourLine} text-left hover:bg-brand-50 focus-visible:z-10 focus-visible:bg-brand-50`}
              style={{ top, height: h }}
              aria-label={`Agendar el ${dateLabel} a las ${hhmm(start)}${who}`}
              onClick={() => onSlot({ date: column.date, time: hhmm(start), professionalId: single })}
            >
              <span className="tabular hidden pl-1.5 text-[11px] font-medium text-brand-700 group-hover:inline group-focus-visible:inline">+ {hhmm(start)}</span>
            </button>
          );
        }
        return (
          <div
            key={start}
            aria-hidden
            className={`absolute inset-x-0 ${hourLine} ${state === "off" ? "pattern-off" : state === "past" ? "bg-stone-50" : ""}`}
            style={{ top, height: h }}
          />
        );
      })}

      {bands.map(({ start, end, block }) => (
        <div
          key={`${block.id}-${column.date}`}
          className="pattern-block absolute inset-x-0 z-[1] border-y border-amber-300 px-1.5 py-0.5"
          style={{ top: (Math.max(start, bounds.start) - bounds.start) * PX_PER_MIN, height: (Math.min(end, bounds.end) - Math.max(start, bounds.start)) * PX_PER_MIN }}
        >
          <span className="rounded bg-amber-100/90 px-1 text-[11px] font-semibold text-amber-950">
            Bloqueo · {TIME_OFF_LABEL[block.kind]}
            {column.professionalIds.length > 1 ? ` · ${professionalNames[block.professional_id] ?? ""}` : ""}
          </span>
        </div>
      ))}

      {events.map((e) => {
        const a = e.appointment;
        const top = (Math.max(e.start, bounds.start) - bounds.start) * PX_PER_MIN;
        const h = Math.max((Math.min(e.end, bounds.end) - Math.max(e.start, bounds.start)) * PX_PER_MIN - 2, 18);
        const compact = h < 40;
        const cancelled = a.status === "cancelled";
        return (
          <button
            key={`${a.id}-${column.date}`}
            type="button"
            onClick={() => onSelect(a)}
            aria-label={`${a.local_start.slice(11)} a ${a.local_end.slice(11)}, ${a.contact_name}, ${a.service_name}, ${a.professional_name}, ${STATUS_LABEL[a.status]}`}
            className={`absolute z-[2] overflow-hidden rounded-lg border border-l-4 border-line bg-surface px-1.5 py-1 text-left shadow-sm hover:shadow-md focus-visible:z-10 ${STATUS_STYLE[a.status].card} ${cancelled ? "opacity-70" : ""}`}
            style={{
              top: top + 1,
              height: h,
              left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`,
              width: `calc(${100 / e.lanes}% - 4px)`,
            }}
          >
            {compact ? (
              <span className="flex items-center gap-1 truncate text-xs">
                <span className="tabular font-semibold">{a.local_start.slice(11)}</span>
                <span className={`truncate ${cancelled ? "line-through" : ""}`}>{a.contact_name}</span>
              </span>
            ) : (
              <>
                <span className="flex items-center justify-between gap-1">
                  <span className="tabular text-xs font-semibold text-ink-soft">
                    {a.local_start.slice(11)}–{a.local_end.slice(11)}
                  </span>
                  <StatusBadge status={a.status} size="sm" />
                </span>
                <span className={`block truncate text-sm font-semibold ${cancelled ? "line-through" : ""}`}>{a.contact_name}</span>
                <span className="block truncate text-xs text-ink-soft">
                  {a.service_name}
                  {a.pet_name ? (
                    <>
                      {" · "}
                      <PawPrint className="inline size-3" aria-hidden /> {a.pet_name}
                    </>
                  ) : null}
                </span>
                {showProfessional ? (
                  <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: a.professional_color }} />
                    {a.professional_name}
                  </span>
                ) : null}
              </>
            )}
          </button>
        );
      })}

      {showNow && nowMinutes !== null && nowMinutes >= bounds.start && nowMinutes <= bounds.end ? (
        <div className="pointer-events-none absolute inset-x-0 z-[3] border-t-2 border-red-600/80" style={{ top: (nowMinutes - bounds.start) * PX_PER_MIN }}>
          <span className="sr-only">Hora actual {hhmm(nowMinutes)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function minutesSpan(a: { local_start: string; local_end: string }) {
  return minutesOf(a.local_end.slice(11)) - minutesOf(a.local_start.slice(11));
}
