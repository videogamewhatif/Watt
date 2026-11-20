"use client";

import { startTransition, useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, TextField } from "@/components/ui/field";
import type { OrganizationKind, ProfessionalTypeRow } from "@/lib/database.types";
import { KIND_LABEL } from "@/lib/labels";
import { MEXICO_TIMEZONES } from "@/lib/tz";
import { createWorkspace } from "./actions";

const KIND_HELP: Record<OrganizationKind, string> = {
  hospital: "Varios profesionales, recepción y administración.",
  clinic: "Un equipo de profesionales que comparte recepción.",
  independent: "Un profesional que administra su propia consulta.",
};

export function CreateWorkspaceForm({ types, defaultName }: { types: ProfessionalTypeRow[]; defaultName: string }) {
  const [state, action, pending] = useActionState(createWorkspace, null);
  const [kind, setKind] = useState<OrganizationKind>("independent");
  const [alsoProfessional, setAlsoProfessional] = useState(true);
  // Campos controlados: se conservan si el servidor rechaza el envío.
  const [values, setValues] = useState({ name: "", timezone: "America/Mexico_City", displayName: defaultName, professionalType: "medico", specialty: "" });
  const bind = (key: keyof typeof values) => ({
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        // Envío manual: si el servidor rechaza los datos, el formulario conserva lo capturado.
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => action(formData));
      }}
    >
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <TextField label="Nombre del espacio" name="name" required placeholder="Ej. Consultorio Dra. López" error={fe.name} autoComplete="organization" {...bind("name")} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Tipo de espacio</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(KIND_LABEL) as OrganizationKind[]).map((k) => (
            <label
              key={k}
              className={`cursor-pointer rounded-xl border p-3 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] ${
                kind === k ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line-strong bg-surface hover:bg-sunken"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setAlsoProfessional(k === "independent");
                }}
                className="sr-only"
              />
              <span className="block font-semibold">{KIND_LABEL[k]}</span>
              <span className="mt-0.5 block text-xs text-muted">{KIND_HELP[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Zona horaria" hint="Las horas de la agenda y los horarios de atención usan esta zona." error={fe.timezone}>
        {({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} name="timezone" {...bind("timezone")}>
            {MEXICO_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="space-y-4 rounded-xl border border-line bg-canvas p-4">
        <Checkbox
          name="alsoProfessional"
          checked={alsoProfessional}
          onChange={(e) => setAlsoProfessional(e.target.checked)}
          label="Yo también atiendo consultas"
          description="Creamos tu perfil profesional vinculado a esta cuenta, para que recibas citas sin una segunda cuenta."
        />
        {alsoProfessional ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nombre en la agenda" name="displayName" error={fe.displayName} hint="Ej. Dra. Ana López" {...bind("displayName")} />
            <Field label="Tipo de profesional">
              {({ id }) => (
                <Select id={id} name="professionalType" {...bind("professionalType")}>
                  {types.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Especialidad o área" className="sm:col-span-2" error={fe.specialty}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} aria-describedby={describedBy} invalid={invalid} name="specialty" placeholder="Opcional" {...bind("specialty")} />
              )}
            </Field>
          </div>
        ) : null}
      </div>

      <Button type="submit" pending={pending} className="w-full sm:w-auto">
        Crear espacio de trabajo
      </Button>
    </form>
  );
}
