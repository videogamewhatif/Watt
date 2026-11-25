"use client";

import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STATUS_STYLE, StatusBadge } from "@/components/ui/status-badge";
import type { AgendaAppointment, AgendaTimeOff } from "@/lib/database.types";
import { TIME_OFF_LABEL } from "@/lib/labels";
import { formatMediumDate } from "@/lib/tz";
import { clipToDay } from "../grid";

type Props = {
  days: string[];
  today: string;
  appointments: AgendaAppointment[];
  timeOff: AgendaTimeOff[];
  professionalNames: Record<string, string>;
  showProfessional: boolean;
  onSelect: (a: AgendaAppointment) => void;
  onNew: (date: string) => void;
};

/** Lista cronológica, agrupada por día. Es la vista por omisión en teléfonos. */
export function ListView({ days, today, appointments, timeOff, professionalNames, showProfessional, onSelect, onNew }: Props) {
  return (
    <div className="space-y-6">
      {days.map((day) => {
        const items = appointments.filter((a) => a.local_start.startsWith(day));
        const blocks = timeOff.filter((t) => clipToDay(t, day));
        return (
          <section key={day} aria-labelledby={`dia-${day}`}>
            <h2 id={`dia-${day}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-soft">
              {formatMediumDate(day)}
              {day === today ? <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[11px] text-white">Hoy</span> : null}
              <span className="font-normal text-muted">· {items.length === 1 ? "1 cita" : `${items.length} citas`}</span>
            </h2>
            {blocks.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {blocks.map((b) => {
                  const c = clipToDay(b, day)!;
                  const full = c.start === 0 && c.end === 1440;
                  return (
                    <li key={b.id} className="pattern-block rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-950">
                      <strong>Bloqueo · {TIME_OFF_LABEL[b.kind]}</strong>
                      {" · "}
                      {full ? "Todo el día" : `${b.local_start.startsWith(day) ? b.local_start.slice(11) : "00:00"}–${b.local_end.startsWith(day) ? b.local_end.slice(11) : "24:00"}`}
                      {showProfessional ? ` · ${professionalNames[b.professional_id] ?? ""}` : ""}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {items.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-4 text-sm text-muted">
                Sin citas este día.
                {day >= today ? (
                  <Button size="sm" variant="subtle" onClick={() => onNew(day)} icon={<CalendarPlus className="size-4" aria-hidden />}>
                    Agendar
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {items.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(a)}
                      className={`flex w-full items-start gap-3 border-l-4 px-3 py-3 text-left hover:bg-sunken sm:items-center ${STATUS_STYLE[a.status].card}`}
                    >
                      <span className="tabular w-14 shrink-0 text-sm font-semibold">
                        {a.local_start.slice(11)}
                        <span className="block text-xs font-normal text-muted">{a.local_end.slice(11)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-semibold ${a.status === "cancelled" ? "text-muted line-through" : ""}`}>{a.contact_name}</span>
                        <span className="block truncate text-sm text-ink-soft">
                          {a.service_name}
                        </span>
                        {showProfessional ? (
                          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: a.professional_color }} />
                            {a.professional_name}
                          </span>
                        ) : null}
                      </span>
                      <StatusBadge status={a.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
