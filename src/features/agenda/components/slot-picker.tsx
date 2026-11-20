"use client";

import { CalendarSearch, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, Spinner } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatDuration, formatMediumDate, formatShortDate, hhmm, isTime, minutesOf } from "@/lib/tz";
import { fetchSlots, findNextSlots, type Slot } from "../actions";

type Props = {
  organizationId: string;
  professionalId: string | null;
  serviceId: string | null;
  durationMinutes: number | null;
  date: string;
  time: string | null;
  today: string;
  onChange: (value: { date: string; time: string | null }) => void;
  excludeAppointmentId?: string | null;
  /** Cambia para forzar una nueva consulta (p. ej., tras un conflicto al guardar). */
  refreshKey?: number;
  error?: string;
};

type SlotState = { key: string; status: "idle" | "loading" | "error" | "ready"; slots: Slot[]; message?: string };

/**
 * Elige fecha y hora entre los horarios realmente disponibles del profesional y
 * servicio. Permite escribir otra hora: el servidor la valida al guardar.
 */
export function SlotPicker(props: Props) {
  const { organizationId, professionalId, serviceId, durationMinutes, date, time, today, onChange, excludeAppointmentId, refreshKey = 0, error } = props;
  const [state, setState] = useState<SlotState>({ key: "", status: "idle", slots: [] });
  const [suggestions, setSuggestions] = useState<Slot[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [searchingNext, setSearchingNext] = useState(false);
  const [manual, setManual] = useState(false);
  const groupId = useId();
  const ready = Boolean(professionalId && serviceId && date);
  const requestKey = `${professionalId}|${serviceId}|${date}|${excludeAppointmentId ?? ""}|${refreshKey}|${retry}`;

  useEffect(() => {
    if (!professionalId || !serviceId || !date) return;
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, key: requestKey, status: "loading" }));
      const result = await fetchSlots({ organizationId, professionalId, serviceId, date, days: 1, excludeAppointmentId });
      if (cancelled) return;
      setState(result.ok ? { key: requestKey, status: "ready", slots: result.data } : { key: requestKey, status: "error", slots: [], message: result.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, professionalId, serviceId, date, excludeAppointmentId, requestKey]);

  const searchNext = async () => {
    if (!professionalId || !serviceId) return;
    setSearchingNext(true);
    const from = date < today ? today : date;
    const result = await findNextSlots({ organizationId, professionalId, serviceId, date: from, excludeAppointmentId, limit: 6 });
    setSearchingNext(false);
    if (!result.ok) {
      setSuggestions(null);
      setSuggestError(result.error);
      return;
    }
    setSuggestError(null);
    setSuggestions(result.data);
    if (result.data[0]) onChange({ date: result.data[0].date, time: result.data[0].time });
  };

  const loading = ready && (state.status === "loading" || state.key !== requestKey);
  const slots = state.key === requestKey ? state.slots : [];
  const selectedInSlots = time ? slots.some((s) => s.time === time) : false;
  const endTime = time && durationMinutes && isTime(time) ? hhmm(minutesOf(time) + durationMinutes) : null;

  return (
    <div className="space-y-4">
      <Field label="Fecha" required>
        {({ id }) => (
          <Input
            id={id}
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setSuggestions(null);
              setSuggestError(null);
              onChange({ date: e.target.value, time: null });
            }}
            required
          />
        )}
      </Field>

      <fieldset aria-describedby={error ? `${groupId}-error` : undefined}>
        <legend className="mb-1.5 text-sm font-medium">
          Hora <span className="text-red-700">*</span>
        </legend>
        {!ready ? (
          <p className="text-sm text-muted">Elige profesional, servicio y fecha para ver los horarios disponibles.</p>
        ) : loading ? (
          <Spinner label="Buscando horarios disponibles…" />
        ) : state.status === "error" ? (
          <div className="flex items-center gap-3 text-sm text-red-700">
            {state.message}
            <Button size="sm" variant="secondary" onClick={() => setRetry((r) => r + 1)} icon={<RefreshCw className="size-4" aria-hidden />}>
              Reintentar
            </Button>
          </div>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted">No hay horarios disponibles el {formatMediumDate(date).toLowerCase()}.</p>
        ) : (
          <div role="radiogroup" aria-label="Horarios disponibles" className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto p-0.5">
            {slots.map((s) => {
              const checked = s.time === time;
              return (
                <button
                  key={s.time}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => {
                    setManual(false);
                    onChange({ date, time: s.time });
                  }}
                  className={`tabular h-9 rounded-lg border px-3 text-sm font-medium ${
                    checked ? "border-brand-700 bg-brand-700 text-white" : "border-line-strong bg-surface hover:border-brand-500 hover:bg-brand-50"
                  }`}
                >
                  {s.time}
                </button>
              );
            })}
          </div>
        )}

        {ready ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={searchNext} pending={searchingNext} icon={<CalendarSearch className="size-4" aria-hidden />}>
              Siguiente disponible
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setManual((m) => !m)} aria-expanded={manual}>
              Otra hora
            </Button>
            {manual ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Hora exacta</span>
                <Input
                  type="time"
                  step={300}
                  value={time ?? ""}
                  onChange={(e) => onChange({ date, time: e.target.value || null })}
                  className="h-9 w-32"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p id={`${groupId}-error`} className="mt-2 text-sm font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        {suggestError ? (
          <p className="mt-2 text-sm font-medium text-red-700" role="alert">
            {suggestError}
          </p>
        ) : null}

        {suggestions && suggestions.length > 0 ? (
          <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
            <p className="text-sm font-medium">Próximos horarios disponibles</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={`${s.date}-${s.time}`}
                  type="button"
                  onClick={() => onChange({ date: s.date, time: s.time })}
                  className={`tabular rounded-lg border px-2.5 py-1.5 text-sm ${
                    s.date === date && s.time === time ? "border-brand-700 bg-brand-700 text-white" : "border-line-strong bg-surface hover:bg-brand-50"
                  }`}
                >
                  {formatShortDate(s.date)} · {s.time}
                </button>
              ))}
            </div>
          </div>
        ) : suggestions ? (
          <p className="mt-2 text-sm text-muted">No encontramos horarios libres en las próximas 8 semanas.</p>
        ) : null}
      </fieldset>

      {time && endTime ? (
        <p className="tabular rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900" aria-live="polite">
          <strong>{formatMediumDate(date)}</strong>, de {time} a {endTime} ({formatDuration(durationMinutes!)})
          {!selectedInSlots && !loading ? <span className="block text-xs text-amber-800">Hora fuera de la lista: se validará al guardar.</span> : null}
        </p>
      ) : null}
    </div>
  );
}
