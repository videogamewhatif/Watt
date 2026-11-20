"use client";

import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import type { AppointmentStatus } from "@/lib/database.types";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/labels";
import { formatLongDate, formatWeekRange, isLocalDate } from "@/lib/tz";
import { type AgendaQuery, type AgendaView, agendaHref, agendaRange, stepDate } from "../params";
import type { AgendaProfessional, AgendaService } from "../queries";

type Props = {
  query: AgendaQuery;
  today: string;
  professionals: AgendaProfessional[];
  services: AgendaService[];
  showProfessionalFilter: boolean;
  onNew: () => void;
};

const VIEWS: { value: AgendaView | null; label: string }[] = [
  { value: "dia", label: "Día" },
  { value: "semana", label: "Semana" },
  { value: "lista", label: "Lista" },
];

export function AgendaToolbar({ query, today, professionals, services, showProfessionalFilter, onNew }: Props) {
  const router = useRouter();
  const ids = { date: useId(), prof: useId(), service: useId(), status: useId() };
  const range = agendaRange(query);
  const title = query.view === "semana" ? formatWeekRange(range.from, range.to) : formatLongDate(query.date);
  const go = (overrides: Partial<AgendaQuery>) => router.push(agendaHref({ ...query, appointmentId: null, openNew: false }, overrides));
  const hasFilters = Boolean(query.professionalId || query.serviceId || query.status);
  const base = { ...query, appointmentId: null, openNew: false };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={agendaHref(base, { date: today })} className={buttonClass("secondary", "md")} aria-current={query.date === today ? "date" : undefined}>
            Hoy
          </Link>
          <Link href={agendaHref(base, { date: stepDate(query, -1) })} className={buttonClass("ghost", "md", "px-2")} aria-label={query.view === "semana" ? "Semana anterior" : "Día anterior"}>
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <Link href={agendaHref(base, { date: stepDate(query, 1) })} className={buttonClass("ghost", "md", "px-2")} aria-label={query.view === "semana" ? "Semana siguiente" : "Día siguiente"}>
            <ChevronRight className="size-5" aria-hidden />
          </Link>
        </div>
        <label htmlFor={ids.date} className="sr-only">
          Ir a la fecha
        </label>
        <input
          id={ids.date}
          type="date"
          value={query.date}
          onChange={(e) => isLocalDate(e.target.value) && go({ date: e.target.value })}
          className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm"
        />
        <h1 className="order-last w-full text-lg font-semibold tracking-tight sm:order-none sm:w-auto sm:flex-1 sm:px-2 sm:text-xl" aria-live="polite">
          {title}
        </h1>
        <Button onClick={onNew} icon={<CalendarPlus className="size-4" aria-hidden />} className="ml-auto sm:ml-0">
          Nueva cita
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <nav aria-label="Vista de la agenda" className="flex rounded-lg border border-line-strong bg-surface p-0.5">
          {VIEWS.map((v) => {
            const current = query.view === v.value || (query.view === null && v.value === "dia");
            return (
              <Link
                key={v.label}
                href={agendaHref(base, { view: v.value })}
                aria-current={current ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${current ? "bg-brand-700 text-white" : "text-ink-soft hover:bg-sunken"} ${
                  query.view === null && v.value === "dia" ? "max-md:bg-transparent max-md:text-ink-soft" : ""
                } ${query.view === null && v.value === "lista" ? "max-md:bg-brand-700 max-md:text-white" : ""}`}
              >
                {v.label}
              </Link>
            );
          })}
        </nav>

        {showProfessionalFilter ? (
          <div className="min-w-0">
            <label htmlFor={ids.prof} className="sr-only">
              Profesional
            </label>
            <select
              id={ids.prof}
              value={query.professionalId ?? ""}
              onChange={(e) => go({ professionalId: e.target.value || null })}
              className="h-9 max-w-[14rem] rounded-lg border border-line-strong bg-surface px-2 text-sm"
            >
              <option value="">Todos los profesionales</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                  {p.active ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor={ids.service} className="sr-only">
            Servicio
          </label>
          <select
            id={ids.service}
            value={query.serviceId ?? ""}
            onChange={(e) => go({ serviceId: e.target.value || null })}
            className="h-9 max-w-[12rem] rounded-lg border border-line-strong bg-surface px-2 text-sm"
          >
            <option value="">Todos los servicios</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.status} className="sr-only">
            Estado
          </label>
          <select
            id={ids.status}
            value={query.status ?? ""}
            onChange={(e) => go({ status: (e.target.value || null) as AppointmentStatus | null })}
            className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"
          >
            <option value="">Todos los estados</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {hasFilters ? (
          <Link href={agendaHref({ date: query.date, view: query.view })} className="px-2 py-1.5 text-sm font-medium text-brand-700 hover:underline">
            Quitar filtros
          </Link>
        ) : null}
      </div>
    </div>
  );
}
