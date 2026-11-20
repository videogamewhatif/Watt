"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { agendaHref } from "@/features/agenda/params";
import type { ProfessionalRow, ProfessionalTypeRow, TimeOffKind } from "@/lib/database.types";
import { PROFESSIONAL_COLORS, TIME_OFF_LABEL, WEEKDAYS } from "@/lib/labels";
import { formatDuration, minutesOf } from "@/lib/tz";
import {
  createTimeOff,
  deleteTimeOff,
  futureAppointmentsCount,
  linkProfessionalAccount,
  saveProfessional,
  saveWeeklySchedule,
  setProfessionalActive,
  setProfessionalServices,
} from "./actions";

// ---------------------------------------------------------------------------
// Datos del profesional
// ---------------------------------------------------------------------------
export function ProfessionalForm({
  organizationId,
  types,
  professional,
}: {
  organizationId: string;
  types: ProfessionalTypeRow[];
  professional?: Pick<ProfessionalRow, "id" | "display_name" | "professional_type" | "specialty" | "color" | "email" | "phone">;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [values, setValues] = useState({
    displayName: professional?.display_name ?? "",
    professionalType: professional?.professional_type ?? "medico",
    specialty: professional?.specialty ?? "",
    color: professional?.color ?? PROFESSIONAL_COLORS[0],
    email: professional?.email ?? "",
    phone: professional?.phone ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveProfessional({ organizationId, id: professional?.id ?? null, ...values });
          if (result.ok) {
            setErrors({});
            setFormError(null);
            notify(result.message ?? "Guardado.");
            if (!professional) router.push(`/profesionales/${result.data.id}`);
            else router.refresh();
          } else {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.fieldErrors ? null : result.error);
          }
        });
      }}
    >
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre como aparece en la agenda" required value={values.displayName} onChange={set("displayName")} error={errors.displayName} placeholder="Ej. Dra. Ana Ruiz" />
        <Field label="Tipo de profesional" required error={errors.professionalType}>
          {({ id }) => (
            <Select id={id} value={values.professionalType} onChange={set("professionalType")}>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField label="Especialidad o área" value={values.specialty} onChange={set("specialty")} error={errors.specialty} placeholder="Opcional" />
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Color en la agenda</legend>
          <div className="flex flex-wrap gap-2">
            {PROFESSIONAL_COLORS.map((c, i) => (
              <label key={c} className="relative cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] rounded-full">
                <input type="radio" name="color" value={c} checked={values.color === c} onChange={set("color")} className="sr-only" aria-label={`Color ${i + 1}`} />
                <span
                  aria-hidden
                  className={`block size-8 rounded-full border-2 ${values.color === c ? "border-ink ring-2 ring-surface ring-inset" : "border-transparent"}`}
                  style={{ background: c }}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <TextField label="Correo de contacto" type="email" value={values.email} onChange={set("email")} error={errors.email} placeholder="Opcional" />
        <TextField label="Teléfono" type="tel" value={values.phone} onChange={set("phone")} error={errors.phone} placeholder="Opcional" />
      </div>
      <Button type="submit" pending={pending}>
        {professional ? "Guardar cambios" : "Registrar profesional"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Servicios que ofrece
// ---------------------------------------------------------------------------
export function ServicesPicker({
  organizationId,
  professionalId,
  services,
  selected,
  readOnly,
}: {
  organizationId: string;
  professionalId: string;
  services: { id: string; name: string; duration_minutes: number; active: boolean }[];
  selected: string[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [ids, setIds] = useState(new Set(selected));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (services.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aún no hay servicios.{" "}
        {readOnly ? null : (
          <Link href="/servicios" className="font-medium text-brand-700 hover:underline">
            Crea el primero
          </Link>
        )}
      </p>
    );
  }
  if (readOnly) {
    const names = services.filter((s) => ids.has(s.id));
    return names.length ? (
      <ul className="flex flex-wrap gap-2">
        {names.map((s) => (
          <li key={s.id} className="rounded-full bg-sunken px-3 py-1 text-sm">
            {s.name} · {formatDuration(s.duration_minutes)}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted">Sin servicios asignados.</p>
    );
  }
  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {services.map((s) => (
          <Checkbox
            key={s.id}
            label={`${s.name}${s.active ? "" : " (inactivo)"}`}
            description={formatDuration(s.duration_minutes)}
            checked={ids.has(s.id)}
            onChange={(e) =>
              setIds((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(s.id);
                else next.delete(s.id);
                return next;
              })
            }
          />
        ))}
      </div>
      <Button
        pending={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setProfessionalServices(organizationId, professionalId, [...ids]);
            if (result.ok) {
              notify(result.message ?? "Guardado.");
              setError(null);
              router.refresh();
            } else setError(result.error);
          })
        }
      >
        Guardar servicios
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horario semanal: varios bloques por día
// ---------------------------------------------------------------------------
type Block = { start: string; end: string };

function validateDay(blocks: Block[]): string | null {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
  for (const b of sorted) {
    if (!b.start || !b.end) return "Completa las horas de cada bloque.";
    if (b.end !== "24:00" && minutesOf(b.end) <= minutesOf(b.start)) return "Cada bloque debe terminar después de empezar.";
  }
  for (let i = 1; i < sorted.length; i++) {
    if (minutesOf(sorted[i].start) < minutesOf(sorted[i - 1].end)) return "Los bloques del mismo día no pueden traslaparse.";
  }
  return null;
}

export function ScheduleEditor({
  organizationId,
  professionalId,
  rules,
  readOnly,
}: {
  organizationId: string;
  professionalId: string;
  rules: { weekday: number; start_time: string; end_time: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const initial: Record<number, Block[]> = {};
  for (const d of WEEKDAYS) {
    initial[d.iso] = rules
      .filter((r) => r.weekday === d.iso)
      .map((r) => ({ start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  const [days, setDays] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (readOnly) {
    return (
      <dl className="divide-y divide-line text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d.iso} className="flex gap-4 py-2">
            <dt className="w-24 font-medium">{d.label}</dt>
            <dd className="tabular text-ink-soft">{days[d.iso].length ? days[d.iso].map((b) => `${b.start}–${b.end}`).join(", ") : <span className="text-muted">No atiende</span>}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const update = (weekday: number, fn: (blocks: Block[]) => Block[]) => setDays((all) => ({ ...all, [weekday]: fn(all[weekday]) }));
  const dayErrors = Object.fromEntries(WEEKDAYS.map((d) => [d.iso, validateDay(days[d.iso])]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Horas locales del espacio. Un día puede tener varios bloques, por ejemplo 09:00–13:00 y 15:00–18:00.</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {warning ? <Alert tone="warning">{warning}</Alert> : null}
      <div className="divide-y divide-line rounded-xl border border-line">
        {WEEKDAYS.map((d) => (
          <fieldset key={d.iso} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start">
            <legend className="sr-only">{d.label}</legend>
            <span aria-hidden className="w-24 pt-2 text-sm font-medium">
              {d.label}
            </span>
            <div className="flex-1 space-y-2">
              {days[d.iso].length === 0 ? <p className="pt-2 text-sm text-muted">No atiende</p> : null}
              {days[d.iso].map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`s-${d.iso}-${i}`}>
                    {d.label}, bloque {i + 1}, inicio
                  </label>
                  <Input id={`s-${d.iso}-${i}`} type="time" step={300} value={b.start} className="h-9 w-32" onChange={(e) => update(d.iso, (bs) => bs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                  <span aria-hidden>–</span>
                  <label className="sr-only" htmlFor={`e-${d.iso}-${i}`}>
                    {d.label}, bloque {i + 1}, fin
                  </label>
                  <Input id={`e-${d.iso}-${i}`} type="time" step={300} value={b.end} className="h-9 w-32" onChange={(e) => update(d.iso, (bs) => bs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" aria-label={`Quitar bloque ${i + 1} del ${d.label.toLowerCase()}`} onClick={() => update(d.iso, (bs) => bs.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {dayErrors[d.iso] ? <p className="text-sm font-medium text-red-700">{dayErrors[d.iso]}</p> : null}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="subtle"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() =>
                  update(d.iso, (bs) => {
                    const last = bs.at(-1);
                    if (!last) return [...bs, { start: "09:00", end: "14:00" }];
                    const s = Math.min(minutesOf(last.end) + 60, 22 * 60);
                    const pad = (n: number) => String(n).padStart(2, "0");
                    const fmt = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
                    return [...bs, { start: fmt(s), end: fmt(Math.min(s + 180, 23 * 60 + 55)) }];
                  })
                }
              >
                Bloque
              </Button>
              {d.iso === 1 && days[1].length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy className="size-4" aria-hidden />}
                  onClick={() => setDays((all) => ({ ...all, 2: [...all[1]], 3: [...all[1]], 4: [...all[1]], 5: [...all[1]] }))}
                >
                  Copiar a mar–vie
                </Button>
              ) : null}
            </div>
          </fieldset>
        ))}
      </div>
      <Button
        pending={pending}
        disabled={Object.values(dayErrors).some(Boolean)}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            setWarning(null);
            const rulesToSave = WEEKDAYS.flatMap((d) => days[d.iso].map((b) => ({ weekday: d.iso, start_time: b.start, end_time: b.end })));
            const result = await saveWeeklySchedule(organizationId, professionalId, rulesToSave);
            if (result.ok) {
              notify(result.message ?? "Guardado.");
              if (result.data.outside > 0) {
                setWarning(
                  `${result.data.outside === 1 ? "1 cita futura quedó" : `${result.data.outside} citas futuras quedaron`} fuera del nuevo horario. Siguen vigentes: revísalas en la agenda.`,
                );
              }
              router.refresh();
            } else setError(result.error);
          })
        }
      >
        Guardar horario
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloqueos puntuales
// ---------------------------------------------------------------------------
export type TimeOffItem = { id: string; kind: TimeOffKind; note: string | null; label: string };

export function TimeOffManager({
  organizationId,
  professionalId,
  items,
  today,
  readOnly,
}: {
  organizationId: string;
  professionalId: string;
  items: TimeOffItem[];
  today: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<TimeOffItem | null>(null);
  const [form, setForm] = useState({ fromDate: today, fromTime: "14:00", toDate: today, toTime: "15:00", allDay: false, kind: "meal" as TimeOffKind, note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {listError ? <Alert tone="error">{listError}</Alert> : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Sin bloqueos próximos.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                <strong>{TIME_OFF_LABEL[b.kind]}</strong> · {b.label}
                {b.note ? <span className="block text-xs text-muted">{b.note}</span> : null}
              </span>
              {readOnly ? null : (
                <Button size="sm" variant="ghost" aria-label={`Quitar bloqueo ${b.label}`} onClick={() => setToDelete(b)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="size-4" aria-hidden />}
          onClick={() => {
            setError(null);
            setErrors({});
            setOpen(true);
          }}
        >
          Agregar bloqueo
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo bloqueo"
        description="Vacaciones, comida o ausencia. Recepción lo verá al agendar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              pending={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await createTimeOff({ organizationId, professionalId, ...form });
                  if (result.ok) {
                    setOpen(false);
                    setErrors({});
                    notify(result.message ?? "Guardado.");
                    router.refresh();
                  } else {
                    setErrors(result.fieldErrors ?? {});
                    setError(result.fieldErrors ? null : result.error);
                  }
                })
              }
            >
              Crear bloqueo
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? (
            <Alert
              tone="error"
              action={
                <Link className="font-semibold underline" href={agendaHref({ date: form.fromDate, view: "lista", professionalId })}>
                  Ver citas de ese día
                </Link>
              }
            >
              {error}
            </Alert>
          ) : null}
          <Field label="Tipo">
            {({ id }) => (
              <Select id={id} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as TimeOffKind }))}>
                {(Object.keys(TIME_OFF_LABEL) as TimeOffKind[]).map((k) => (
                  <option key={k} value={k}>
                    {TIME_OFF_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Checkbox label="Todo el día" checked={form.allDay} onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Desde (fecha)" type="date" value={form.fromDate} min={today} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value, toDate: f.toDate < e.target.value ? e.target.value : f.toDate }))} error={errors.fromDate} />
            {form.allDay ? <div /> : <TextField label="Hora de inicio" type="time" step={300} value={form.fromTime} onChange={(e) => setForm((f) => ({ ...f, fromTime: e.target.value }))} error={errors.fromTime} />}
            <TextField label="Hasta (fecha)" type="date" value={form.toDate} min={form.fromDate} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} error={errors.toDate} />
            {form.allDay ? <div /> : <TextField label="Hora de fin" type="time" step={300} value={form.toTime} onChange={(e) => setForm((f) => ({ ...f, toTime: e.target.value }))} error={errors.toTime} />}
          </div>
          <TextField label="Nota (opcional)" value={form.note} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} error={errors.note} hint="Visible para el equipo. Sin datos de pacientes." />
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="¿Quitar este bloqueo?"
        confirmLabel="Quitar bloqueo"
        pending={pending}
        onClose={() => setToDelete(null)}
        onConfirm={() =>
          startTransition(async () => {
            if (!toDelete) return;
            const result = await deleteTimeOff(organizationId, toDelete.id);
            setToDelete(null);
            if (result.ok) {
              setListError(null);
              notify(result.message ?? "Eliminado.");
              router.refresh();
            } else setListError(result.error);
          })
        }
      >
        <p>
          {toDelete ? `${TIME_OFF_LABEL[toDelete.kind]} · ${toDelete.label}` : ""}. Ese horario volverá a estar disponible para agendar.
        </p>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado y cuenta de acceso
// ---------------------------------------------------------------------------
export function ActiveToggle({ organizationId, professionalId, active, name }: { organizationId: string; professionalId: string; active: boolean; name: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [future, setFuture] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = (next: boolean) =>
    startTransition(async () => {
      const result = await setProfessionalActive(organizationId, professionalId, next);
      setConfirming(false);
      if (result.ok) {
        notify(result.message ?? "Guardado.");
        router.refresh();
      } else setError(result.error);
    });

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {active ? (
        <Button
          variant="secondary"
          className="text-red-700"
          onClick={() =>
            startTransition(async () => {
              setFuture(await futureAppointmentsCount(organizationId, professionalId));
              setConfirming(true);
            })
          }
          pending={pending && !confirming}
        >
          Desactivar profesional
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => apply(true)} pending={pending}>
          Reactivar profesional
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title={`¿Desactivar a ${name}?`}
        confirmLabel="Desactivar"
        pending={pending}
        onClose={() => setConfirming(false)}
        onConfirm={() => apply(false)}
      >
        <p>Se conserva su historial y deja de recibir nuevas citas. Podrás reactivarlo después.</p>
        {future ? (
          <Alert tone="warning" title={`Tiene ${future === 1 ? "1 cita futura" : `${future} citas futuras`} pendientes o confirmadas`}>
            No se cancelarán automáticamente. Reprográmalas con otro profesional o cancélalas desde la{" "}
            <Link className="font-semibold underline" href={agendaHref({ view: "lista", professionalId })}>
              agenda
            </Link>
            .
          </Alert>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

export function AccountLink({
  organizationId,
  professionalId,
  linked,
  candidates,
}: {
  organizationId: string;
  professionalId: string;
  linked: { id: string; name: string; email: string | null } | null;
  candidates: { id: string; name: string; email: string | null }[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (value: string | null) =>
    startTransition(async () => {
      const result = await linkProfessionalAccount(organizationId, professionalId, value);
      if (result.ok) {
        notify(result.message ?? "Guardado.");
        setError(null);
        router.refresh();
      } else setError(result.error);
    });

  return (
    <div className="space-y-3 text-sm">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunken px-3 py-2">
          <span>
            Vinculado a <strong>{linked.name}</strong>
            {linked.email ? <span className="text-muted"> · {linked.email}</span> : null}
          </span>
          <Button size="sm" variant="ghost" pending={pending} onClick={() => run(null)}>
            Desvincular
          </Button>
        </div>
      ) : (
        <>
          <p className="text-muted">Este profesional no tiene cuenta. Recepción puede agendarle igual.</p>
          {candidates.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Vincular con un miembro del espacio">
                {({ id }) => (
                  <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)} className="min-w-56">
                    <option value="">Elige una cuenta</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.email ? `(${c.email})` : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="secondary" disabled={!userId} pending={pending} onClick={() => run(userId)}>
                Vincular
              </Button>
            </div>
          ) : null}
          <p>
            O{" "}
            <Link href={`/configuracion?invitar=${professionalId}#miembros`} className="font-medium text-brand-700 hover:underline">
              invítalo a Wattalis
            </Link>{" "}
            con un enlace de un solo uso.
          </p>
        </>
      )}
    </div>
  );
}
