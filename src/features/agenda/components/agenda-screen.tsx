"use client";

import { CalendarX2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { AgendaAppointment } from "@/lib/database.types";
import { formatShortDate } from "@/lib/tz";
import { getAppointment } from "../actions";
import { type AgendaQuery, agendaHref } from "../params";
import type { AgendaData } from "../queries";
import { AppointmentDetail } from "./appointment-detail";
import { type AppointmentDraft, AppointmentForm } from "./appointment-form";
import { CalendarGrid, type GridColumn } from "./calendar-grid";
import { ListView } from "./list-view";
import { AgendaToolbar } from "./toolbar";

type Props = {
  data: AgendaData;
  query: AgendaQuery;
  canSeeAll: boolean;
  canManageCatalog: boolean;
  ownProfessionalId: string | null;
};

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Simbología">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3.5 rounded border border-line bg-surface" /> Disponible
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="pattern-off size-3.5 rounded border border-line" /> Fuera de horario
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="pattern-block size-3.5 rounded border border-amber-300" /> Bloqueo
      </li>
      <li>Las citas muestran su estado con texto. Las canceladas aparecen en la lista.</li>
    </ul>
  );
}

export function AgendaScreen({ data, query, canSeeAll, canManageCatalog, ownProfessionalId }: Props) {
  const router = useRouter();
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(query.appointmentId);
  const [fetched, setFetched] = useState<AgendaAppointment | null>(null);
  const [draft, setDraft] = useState<AppointmentDraft | null>(query.openNew ? { date: query.date, time: null, professionalId: query.professionalId } : null);

  // Next conserva el estado cuando solo cambian los parámetros de búsqueda: si un enlace
  // (p. ej. «Ver» en un aviso) trae ?cita= o ?nueva=1, se refleja aquí.
  const [linked, setLinked] = useState({ appointmentId: query.appointmentId, openNew: query.openNew, date: query.date });
  if (linked.appointmentId !== query.appointmentId || linked.openNew !== query.openNew || linked.date !== query.date) {
    setLinked({ appointmentId: query.appointmentId, openNew: query.openNew, date: query.date });
    if (query.appointmentId && query.appointmentId !== linked.appointmentId) setSelectedId(query.appointmentId);
    if (query.openNew && !linked.openNew) setDraft({ date: query.date, time: null, professionalId: query.professionalId });
  }

  const professionalNames = useMemo(() => Object.fromEntries(data.professionals.map((p) => [p.id, p.display_name])), [data.professionals]);

  // Profesionales visibles como columnas: activos (o con citas en el rango) y según el filtro.
  const visible = useMemo(() => {
    const withAppointments = new Set(data.appointments.map((a) => a.professional_id));
    let list = data.professionals.filter((p) => p.active || withAppointments.has(p.id));
    if (!canSeeAll && ownProfessionalId) list = list.filter((p) => p.id === ownProfessionalId);
    if (query.professionalId) list = list.filter((p) => p.id === query.professionalId);
    if (query.serviceId) list = list.filter((p) => p.service_ids.includes(query.serviceId!) || withAppointments.has(p.id));
    return list;
  }, [data.professionals, data.appointments, canSeeAll, ownProfessionalId, query.professionalId, query.serviceId]);

  const singleProfessional = data.professionals.filter((p) => p.active).length <= 1;
  const showProfessional = visible.length > 1;
  const gridAppointments = query.status ? data.appointments : data.appointments.filter((a) => a.status !== "cancelled");
  const selected = data.appointments.find((a) => a.id === selectedId) ?? (fetched?.id === selectedId ? fetched : null);

  const syncUrl = useCallback(
    (appointmentId: string | null) => {
      window.history.replaceState(null, "", agendaHref({ ...query, openNew: false }, { appointmentId }));
    },
    [query],
  );

  useEffect(() => {
    if (!selectedId || data.appointments.some((a) => a.id === selectedId) || fetched?.id === selectedId) return;
    let cancelled = false;
    getAppointment(data.organizationId, selectedId).then((result) => {
      if (cancelled) return;
      if (result.ok) setFetched(result.data);
      else {
        setSelectedId(null);
        notify(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, data.appointments, data.organizationId, fetched, notify]);

  const openDetail = (a: AgendaAppointment) => {
    setSelectedId(a.id);
    // Copia de respaldo: si tras un cambio la cita sale del rango o del filtro, el panel sigue abierto.
    setFetched(a);
    syncUrl(a.id);
  };
  const closeDetail = () => {
    setSelectedId(null);
    setFetched(null);
    syncUrl(null);
  };
  const openNew = (initial: Partial<AppointmentDraft> = {}) =>
    setDraft({
      date: initial.date ?? (query.date < data.today ? data.today : query.date),
      time: initial.time ?? null,
      professionalId: initial.professionalId ?? query.professionalId ?? (canSeeAll ? null : ownProfessionalId),
    });

  const columnsDay: GridColumn[] = visible.map((p) => ({
    key: p.id,
    date: query.date,
    professionalIds: [p.id],
    isToday: query.date === data.today,
    header: (
      <span className="flex items-center justify-center gap-1.5 font-semibold">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
        <span className="truncate">{p.display_name}</span>
      </span>
    ),
  }));
  const columnsWeek: GridColumn[] = data.days.map((d) => ({
    key: d,
    date: d,
    professionalIds: visible.map((p) => p.id),
    isToday: d === data.today,
    header: (
      <Link href={agendaHref({ ...query, appointmentId: null, openNew: false }, { date: d, view: "dia" })} className="block hover:underline">
        <span className={`block font-semibold first-letter:uppercase ${d === data.today ? "text-brand-800" : ""}`}>{formatShortDate(d)}</span>
      </Link>
    ),
  }));

  const noProfessionals = data.professionals.length === 0 && !data.error;
  const view = query.view;
  const weekHasMany = view === "semana" && visible.length > 1;

  const commonGrid = {
    rules: data.rules,
    appointments: gridAppointments,
    timeOff: data.timeOff,
    professionalNames,
    slotInterval: data.slotInterval,
    today: data.today,
    nowMinutes: data.nowMinutes,
    onSelect: openDetail,
    onSlot: (slot: { date: string; time: string; professionalId: string | null }) => openNew(slot),
  };

  const list = (days: string[]) => (
    <ListView
      days={days}
      today={data.today}
      appointments={data.appointments}
      timeOff={data.timeOff}
      professionalNames={professionalNames}
      showProfessional={showProfessional}
      onSelect={openDetail}
      onNew={(date) => openNew({ date })}
    />
  );

  return (
    <div className="space-y-4">
      <AgendaToolbar
        query={query}
        today={data.today}
        professionals={data.professionals}
        services={data.services}
        showProfessionalFilter={canSeeAll && !singleProfessional}
        onNew={() => openNew()}
      />

      {data.error ? (
        <Alert tone="error" title="No pudimos cargar la agenda completa" action={<button className="font-semibold underline" onClick={() => router.refresh()}>Reintentar</button>}>
          Revisa tu conexión e inténtalo de nuevo.
        </Alert>
      ) : null}

      {noProfessionals ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState
            icon={<CalendarX2 className="size-6" aria-hidden />}
            title={canSeeAll ? "Aún no hay profesionales en este espacio" : "Tu cuenta aún no tiene un perfil profesional vinculado"}
            action={
              canManageCatalog ? (
                <Link href="/profesionales/nuevo" className="font-semibold text-brand-700 hover:underline">
                  Registrar al primer profesional
                </Link>
              ) : null
            }
          >
            {canSeeAll ? "Registra profesionales, sus servicios y horarios para empezar a agendar." : "Pide a la administración que vincule tu cuenta a tu perfil."}
          </EmptyState>
        </div>
      ) : (
        <>
          {weekHasMany ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-muted">
                <Users className="size-4" aria-hidden /> Ver por profesional:
              </span>
              {visible.map((p) => (
                <Link
                  key={p.id}
                  href={agendaHref({ ...query, appointmentId: null, openNew: false }, { professionalId: p.id })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 py-1 hover:bg-sunken"
                >
                  <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
                  {p.display_name}
                </Link>
              ))}
            </div>
          ) : null}

          {view !== "lista" ? <div className="hidden md:block"><Legend /></div> : null}

          {/* Vista automática: día en escritorio, lista del día en teléfono. */}
          {view === null || view === "dia" ? (
            <>
              <div className={view === null ? "hidden md:block" : ""}>
                {columnsDay.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-muted">No hay profesionales que coincidan con los filtros.</p>
                ) : (
                  <CalendarGrid {...commonGrid} columns={columnsDay} showProfessional={false} label={`Agenda del ${query.date}`} />
                )}
              </div>
              {view === null ? <div className="md:hidden">{list([query.date])}</div> : null}
            </>
          ) : null}

          {view === "semana" ? (
            <>
              <div className="hidden md:block">
                <CalendarGrid {...commonGrid} columns={columnsWeek} showProfessional={showProfessional} label="Agenda de la semana" />
              </div>
              <div className="md:hidden">{list(data.days)}</div>
            </>
          ) : null}

          {view === "lista" ? list(data.days) : null}

        </>
      )}

      <Dialog open={Boolean(selected)} onClose={closeDetail} title="Detalle de la cita" variant="drawer" size="md">
        {selected ? (
          <AppointmentDetail
            key={`${selected.id}-${selected.status}-${selected.local_start}`}
            appointment={selected}
            organizationId={data.organizationId}
            timezone={data.timezone}
            today={data.today}
            nowMinutes={data.nowMinutes}
            professionals={data.professionals}
            services={data.services}
            canMoveBetweenProfessionals={canSeeAll}
            onChanged={async (message) => {
              notify(message);
              router.refresh();
              const fresh = await getAppointment(data.organizationId, selected.id);
              if (fresh.ok) setFetched(fresh.data);
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title="Nueva cita"
        description="La hora final se calcula con la duración del servicio."
        variant="drawer"
        size="md"
      >
        {draft ? (
          <AppointmentForm
            organizationId={data.organizationId}
            today={data.today}
            professionals={data.professionals}
            services={data.services}
            lockedProfessionalId={canSeeAll ? null : ownProfessionalId}
            initial={draft}
            onCancel={() => setDraft(null)}
            onCreated={(result, summary) => {
              setDraft(null);
              notify(
                <span>
                  Cita agendada: {formatShortDate(result.date)}, {result.time} · {summary}.{" "}
                  {result.date !== query.date ? (
                    <Link className="font-semibold underline" href={agendaHref({ ...query, appointmentId: null, openNew: false }, { date: result.date, appointmentId: result.id })}>
                      Ver
                    </Link>
                  ) : null}
                </span>,
              );
              router.refresh();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
