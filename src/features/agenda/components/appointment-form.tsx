"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import type { ContactSummary } from "@/features/patients/actions";
import { SLOT_ERRORS } from "@/lib/errors";
import { formatDuration } from "@/lib/tz";
import { createAppointment, type CreateAppointmentResult } from "../actions";
import type { AgendaProfessional, AgendaService } from "../queries";
import { ContactPicker } from "./contact-picker";
import { SlotPicker } from "./slot-picker";

export type AppointmentDraft = { date: string; time: string | null; professionalId: string | null };

type Props = {
  organizationId: string;
  today: string;
  professionals: AgendaProfessional[];
  services: AgendaService[];
  /** Si el rol Profesional solo puede agendar en su propia agenda. */
  lockedProfessionalId: string | null;
  initial: AppointmentDraft;
  onCreated: (result: CreateAppointmentResult, summary: string) => void;
  onCancel: () => void;
};

function newKey() {
  return crypto.randomUUID();
}

export function AppointmentForm({ organizationId, today, professionals, services, lockedProfessionalId, initial, onCreated, onCancel }: Props) {
  const activeProfessionals = professionals.filter((p) => p.active && p.service_ids.length > 0);
  const singleProfessional = activeProfessionals.length === 1 ? activeProfessionals[0].id : null;

  const [professionalId, setProfessionalId] = useState<string | null>(lockedProfessionalId ?? initial.professionalId ?? singleProfessional);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactSummary | null>(null);
  const [date, setDate] = useState(initial.date < today ? today : initial.date);
  const [time, setTime] = useState<string | null>(initial.time);
  const [status, setStatus] = useState<"pending" | "confirmed">("pending");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Una llave por intento de creación: el doble clic o un reintento no duplican la cita.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [pending, startTransition] = useTransition();

  const professional = professionals.find((p) => p.id === professionalId) ?? null;

  // Solo combinaciones válidas: servicios activos del profesional elegido, y viceversa.
  const serviceOptions = useMemo(
    () => services.filter((s) => s.active && (!professional || professional.service_ids.includes(s.id))),
    [services, professional],
  );
  const professionalOptions = useMemo(
    () => activeProfessionals.filter((p) => !serviceId || p.service_ids.includes(serviceId)),
    [activeProfessionals, serviceId],
  );

  // Si el profesional ofrece un solo servicio, se elige automáticamente.
  const effectiveServiceId = serviceId ?? (serviceOptions.length === 1 ? serviceOptions[0].id : null);
  const service = services.find((s) => s.id === effectiveServiceId) ?? null;

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const local: Record<string, string> = {};
      if (!professionalId) local.professionalId = "Elige un profesional.";
      if (!effectiveServiceId) local.serviceId = "Elige un servicio.";
      if (!contact) local.contactId = "Elige o registra al paciente.";
      if (!time) local.time = "Elige un horario.";
      if (Object.keys(local).length) {
        setErrors(local);
        return;
      }
      const result = await createAppointment({
        organizationId,
        professionalId: professionalId!,
        serviceId: effectiveServiceId!,
        contactId: contact!.id,
        date,
        time: time!,
        status,
        notes,
        idempotencyKey,
      });
      if (result.ok) {
        setIdempotencyKey(newKey());
        onCreated(result.data, `${contact!.full_name} · ${service?.name ?? ""} · ${professional?.display_name ?? ""}`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      if (result.code && SLOT_ERRORS.has(result.code)) {
        // Otra persona ocupó el horario o no cabe: se conservan los datos y se actualizan los horarios.
        setErrors({ time: `${result.error} Elige otro horario de la lista actualizada.` });
        setTime(null);
        setRefreshKey((k) => k + 1);
        setIdempotencyKey(newKey());
      } else if (!result.fieldErrors) {
        setFormError(result.error);
      }
    });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      {lockedProfessionalId ? (
        <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
          Profesional: <strong>{professional?.display_name}</strong>
        </p>
      ) : (
        <Field label="Profesional" required error={errors.professionalId}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={professionalId ?? ""}
              onChange={(e) => {
                const next = professionals.find((p) => p.id === e.target.value);
                setProfessionalId(next?.id ?? null);
                if (serviceId && next && !next.service_ids.includes(serviceId)) setServiceId(null);
                // Se conserva la hora elegida (p. ej. al iniciar desde una franja); el selector avisa si no está libre.
                setErrors({});
              }}
            >
              <option value="">Elige un profesional</option>
              {professionalOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                  {p.specialty ? ` · ${p.specialty}` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field
        label="Servicio"
        required
        error={errors.serviceId}
        hint={service ? `Duración: ${formatDuration(service.duration_minutes)}` : professional ? undefined : "Elige primero un profesional para ver solo sus servicios."}
      >
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={effectiveServiceId ?? ""}
            onChange={(e) => {
              setServiceId(e.target.value || null);
              setErrors({});
            }}
          >
            <option value="">Elige un servicio</option>
            {serviceOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({formatDuration(s.duration_minutes)})
              </option>
            ))}
          </Select>
        )}
      </Field>

      <ContactPicker
        organizationId={organizationId}
        value={contact}
        onChange={(c) => {
          setContact(c);
          setErrors((e) => ({ ...e, contactId: "" }));
        }}
        error={errors.contactId || undefined}
      />

      <SlotPicker
        organizationId={organizationId}
        professionalId={professionalId}
        serviceId={effectiveServiceId}
        durationMinutes={service?.duration_minutes ?? null}
        date={date}
        time={time}
        today={today}
        refreshKey={refreshKey}
        error={errors.time}
        onChange={(v) => {
          setDate(v.date);
          setTime(v.time);
          setErrors((e) => ({ ...e, time: "" }));
        }}
      />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Estado inicial</legend>
        <div className="flex gap-2">
          {(["pending", "confirmed"] as const).map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] ${
                status === s ? "border-brand-700 bg-brand-50" : "border-line-strong"
              }`}
            >
              <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="accent-brand-700" />
              {s === "pending" ? "Pendiente" : "Confirmada"}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Nota administrativa" hint="Opcional. No incluyas síntomas, diagnósticos ni información clínica." error={errors.notes}>
        {({ id, describedBy, invalid }) => (
          <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>

      <div className="sticky bottom-0 -mx-5 -mb-4 flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" pending={pending}>
          Agendar cita
        </Button>
      </div>
    </form>
  );
}
