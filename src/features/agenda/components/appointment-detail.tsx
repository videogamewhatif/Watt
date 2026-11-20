"use client";

import { CalendarClock, Check, CheckCheck, History, Mail, PawPrint, Phone, UserX, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, Spinner } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AgendaAppointment, AppointmentStatus } from "@/lib/database.types";
import { STATUS_LABEL } from "@/lib/labels";
import { formatInstant, formatMediumDate, minutesOf, splitLocal } from "@/lib/tz";
import { getAppointmentHistory, type HistoryEntry, rescheduleAppointment, setAppointmentStatus, updateAppointmentDetails } from "../actions";
import type { AgendaProfessional, AgendaService } from "../queries";
import { SlotPicker } from "./slot-picker";

type Props = {
  appointment: AgendaAppointment;
  organizationId: string;
  timezone: string;
  today: string;
  nowMinutes: number;
  professionals: AgendaProfessional[];
  services: AgendaService[];
  canMoveBetweenProfessionals: boolean;
  onChanged: (message: string) => void;
};

function HistoryList({ entries, timezone }: { entries: HistoryEntry[]; timezone: string }) {
  const describe = (e: HistoryEntry) => {
    switch (e.type) {
      case "created":
        return `Creó la cita${e.toStatus ? ` como ${STATUS_LABEL[e.toStatus].toLowerCase()}` : ""}`;
      case "status_changed":
        return `Cambió el estado de ${e.fromStatus ? STATUS_LABEL[e.fromStatus] : "?"} a ${e.toStatus ? STATUS_LABEL[e.toStatus] : "?"}`;
      case "rescheduled": {
        const from = e.fromLocal ? `${formatMediumDate(splitLocal(e.fromLocal).date)} ${splitLocal(e.fromLocal).time}` : "";
        const to = e.toLocal ? `${formatMediumDate(splitLocal(e.toLocal).date)} ${splitLocal(e.toLocal).time}` : "";
        const prof = e.fromProfessional !== e.toProfessional && e.toProfessional ? ` con ${e.toProfessional}` : "";
        return `Reprogramó de ${from} a ${to}${prof}`;
      }
      default:
        return "Actualizó la nota o la mascota";
    }
  };
  return (
    <ol className="space-y-3 border-l border-line pl-4">
      {entries.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-brand-500" />
          <p className="text-ink">{describe(e)}</p>
          <p className="text-xs text-muted">
            {e.actor} · {formatInstant(e.at, timezone)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function AppointmentDetail({ appointment: a, organizationId, timezone, today, nowMinutes, professionals, services, canMoveBetweenProfessionals, onChanged }: Props) {
  const start = splitLocal(a.local_start);
  const end = splitLocal(a.local_end);
  const active = a.status === "pending" || a.status === "confirmed";
  const started = start.date < today || (start.date === today && minutesOf(start.time) <= nowMinutes);
  const professional = professionals.find((p) => p.id === a.professional_id);
  const service = services.find((s) => s.id === a.service_id);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getAppointmentHistory(organizationId, a.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setHistory(result.data);
      else setHistoryError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId, a.id, a.status, a.local_start]);

  const changeStatus = (status: AppointmentStatus, message: string, cancelReason?: string) =>
    startTransition(async () => {
      setError(null);
      const result = await setAppointmentStatus({ organizationId, appointmentId: a.id, status, reason: cancelReason });
      if (result.ok) {
        setConfirmCancel(false);
        onChanged(message);
      } else {
        setConfirmCancel(false);
        setError(result.error);
      }
    });

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={a.status} />
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: a.professional_color }} />
            {a.professional_name}
          </span>
        </div>
        <p className="tabular text-lg font-semibold">
          {formatMediumDate(start.date)}
          <span className="block text-base font-medium text-ink-soft">
            {start.time} – {end.time} · {a.service_name}
          </span>
        </p>
      </div>

      <section aria-labelledby="paciente" className="rounded-xl border border-line p-4">
        <h3 id="paciente" className="text-xs font-semibold tracking-wide text-muted uppercase">
          Paciente o contacto
        </h3>
        <p className="mt-1 font-semibold">
          <Link href={`/pacientes/${a.contact_id}`} className="text-brand-800 underline-offset-4 hover:underline">
            {a.contact_name}
          </Link>
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {a.contact_phone ? (
            <li className="flex items-center gap-2">
              <Phone className="size-4 text-muted" aria-hidden />
              <a href={`tel:${a.contact_phone.replace(/[^\d+]/g, "")}`} className="text-brand-800 hover:underline">
                {a.contact_phone}
              </a>
            </li>
          ) : null}
          {a.contact_email ? (
            <li className="flex items-center gap-2">
              <Mail className="size-4 text-muted" aria-hidden />
              <span className="break-all">{a.contact_email}</span>
            </li>
          ) : null}
          {a.pet_name ? (
            <li className="flex items-center gap-2">
              <PawPrint className="size-4 text-muted" aria-hidden />
              Mascota: <strong>{a.pet_name}</strong>
            </li>
          ) : null}
        </ul>
        {a.notes && !editing ? <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm whitespace-pre-line">{a.notes}</p> : null}
        {editing ? (
          <DetailsEditor
            organizationId={organizationId}
            appointment={a}
            usesPetName={Boolean(professional?.uses_pet_name)}
            onDone={(saved) => {
              setEditing(false);
              if (saved) onChanged("Cambios guardados.");
            }}
          />
        ) : a.status !== "cancelled" ? (
          <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => setEditing(true)}>
            Editar nota{professional?.uses_pet_name ? " o mascota" : ""}
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="acciones" className="space-y-2">
        <h3 id="acciones" className="sr-only">
          Acciones
        </h3>
        {active ? (
          <div className="flex flex-wrap gap-2">
            {a.status === "pending" ? (
              <Button pending={pending} onClick={() => changeStatus("confirmed", "Cita confirmada.")} icon={<Check className="size-4" aria-hidden />}>
                Confirmar
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setRescheduling((r) => !r)} aria-expanded={rescheduling} icon={<CalendarClock className="size-4" aria-hidden />}>
              Reprogramar
            </Button>
            {started ? (
              <>
                <Button variant="secondary" pending={pending} onClick={() => changeStatus("attended", "Cita marcada como atendida.")} icon={<CheckCheck className="size-4" aria-hidden />}>
                  Atendida
                </Button>
                <Button variant="secondary" pending={pending} onClick={() => changeStatus("no_show", "Cita marcada como «No asistió».")} icon={<UserX className="size-4" aria-hidden />}>
                  No asistió
                </Button>
              </>
            ) : null}
            <Button variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setConfirmCancel(true)} icon={<X className="size-4" aria-hidden />}>
              Cancelar cita
            </Button>
          </div>
        ) : null}
        {active && !started ? (
          <p className="text-xs text-muted">«Atendida» y «No asistió» se habilitan cuando la cita ya comenzó.</p>
        ) : null}
        {a.status === "attended" || a.status === "no_show" ? (
          <Button
            size="sm"
            variant="ghost"
            pending={pending}
            onClick={() =>
              a.status === "attended"
                ? changeStatus("no_show", "Corregido: no asistió.")
                : changeStatus("attended", "Corregido: atendida.")
            }
          >
            Corregir: marcar como {a.status === "attended" ? "No asistió" : "Atendida"}
          </Button>
        ) : null}
        {a.status === "cancelled" ? <p className="text-sm text-muted">La cita está cancelada. Su horario quedó libre y el registro se conserva.</p> : null}
      </section>

      {rescheduling && active ? (
        <Reschedule
          appointment={a}
          organizationId={organizationId}
          today={today}
          professionals={professionals}
          durationMinutes={minutesOf(end.time) - minutesOf(start.time)}
          serviceId={service?.id ?? a.service_id}
          canMoveBetweenProfessionals={canMoveBetweenProfessionals}
          onDone={(message) => {
            setRescheduling(false);
            onChanged(message);
          }}
        />
      ) : null}

      <section aria-labelledby="historial">
        <h3 id="historial" className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted" aria-hidden /> Historial
        </h3>
        {history ? (
          <HistoryList entries={history} timezone={timezone} />
        ) : historyError ? (
          <p className="text-sm text-red-700">No pudimos cargar el historial.</p>
        ) : (
          <Spinner label="Cargando historial…" />
        )}
      </section>

      <ConfirmDialog
        open={confirmCancel}
        title="¿Cancelar esta cita?"
        confirmLabel="Sí, cancelar cita"
        cancelLabel="No, conservarla"
        pending={pending}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => changeStatus("cancelled", "Cita cancelada. El horario quedó libre.", reason)}
      >
        <p>
          {a.contact_name} · {formatMediumDate(start.date)}, {start.time}. El registro y su historial se conservan y el horario queda libre.
        </p>
        <Field label="Motivo (opcional)">
          {({ id }) => <Input id={id} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function DetailsEditor({
  organizationId,
  appointment,
  usesPetName,
  onDone,
}: {
  organizationId: string;
  appointment: AgendaAppointment;
  usesPetName: boolean;
  onDone: (saved: boolean) => void;
}) {
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const [petName, setPetName] = useState(appointment.pet_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {usesPetName ? (
        <Field label="Nombre de la mascota">{({ id }) => <Input id={id} value={petName} maxLength={80} onChange={(e) => setPetName(e.target.value)} />}</Field>
      ) : null}
      <Field label="Nota administrativa" hint="No incluyas información clínica.">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          pending={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateAppointmentDetails({ organizationId, appointmentId: appointment.id, notes, petName });
              if (result.ok) onDone(true);
              else setError(result.error);
            })
          }
        >
          Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function Reschedule({
  appointment: a,
  organizationId,
  today,
  professionals,
  durationMinutes,
  serviceId,
  canMoveBetweenProfessionals,
  onDone,
}: {
  appointment: AgendaAppointment;
  organizationId: string;
  today: string;
  professionals: AgendaProfessional[];
  durationMinutes: number;
  serviceId: string;
  canMoveBetweenProfessionals: boolean;
  onDone: (message: string) => void;
}) {
  const start = splitLocal(a.local_start);
  const [professionalId, setProfessionalId] = useState(a.professional_id);
  const [date, setDate] = useState(start.date < today ? today : start.date);
  const [time, setTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const options = professionals.filter((p) => p.active && p.service_ids.includes(serviceId));

  return (
    <section aria-labelledby="reprogramar" className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <h3 id="reprogramar" className="font-semibold">
        Reprogramar
      </h3>
      <p className="text-sm text-muted">Se conserva la misma cita y se registra el cambio de horario. Si el nuevo horario no está libre, la cita se queda donde está.</p>
      {canMoveBetweenProfessionals && options.length > 1 ? (
        <Field label="Profesional">
          {({ id }) => (
            <Select
              id={id}
              value={professionalId}
              onChange={(e) => {
                setProfessionalId(e.target.value);
                setTime(null);
              }}
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <SlotPicker
        organizationId={organizationId}
        professionalId={professionalId}
        serviceId={serviceId}
        durationMinutes={durationMinutes}
        date={date}
        time={time}
        today={today}
        excludeAppointmentId={a.id}
        refreshKey={refreshKey}
        error={error ?? undefined}
        onChange={(v) => {
          setDate(v.date);
          setTime(v.time);
          setError(null);
        }}
      />
      <Button
        pending={pending}
        disabled={!time}
        onClick={() =>
          startTransition(async () => {
            if (!time) return;
            const result = await rescheduleAppointment({
              organizationId,
              appointmentId: a.id,
              date,
              time,
              professionalId: professionalId !== a.professional_id ? professionalId : null,
            });
            if (result.ok) {
              onDone(`Cita movida al ${formatMediumDate(result.data.date).toLowerCase()} a las ${result.data.time}.`);
            } else {
              setError(result.error);
              setTime(null);
              setRefreshKey((k) => k + 1);
            }
          })
        }
      >
        Mover cita
      </Button>
    </section>
  );
}
