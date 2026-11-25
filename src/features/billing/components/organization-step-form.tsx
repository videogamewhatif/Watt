"use client";

import { Building2, Plus } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select, TextField } from "@/components/ui/field";
import type { OrganizationKind } from "@/lib/database.types";
import { KIND_LABEL } from "@/lib/labels";
import { saveOrganizationStep } from "../actions";
import type { BillingInterval } from "../types";

export type WorkspaceChoice = {
  id: string;
  name: string;
  kind: OrganizationKind;
  timezone: string;
  /** null = se puede contratar aquí. */
  blockedReason: string | null;
  hint: string;
  prefill: { contactName: string; billingEmail: string; phone: string; country: string };
};

const COUNTRIES = [
  { value: "MX", label: "México" },
  { value: "CO", label: "Colombia" },
  { value: "PE", label: "Perú" },
  { value: "CL", label: "Chile" },
  { value: "GT", label: "Guatemala" },
  { value: "US", label: "Estados Unidos" },
  { value: "ES", label: "España" },
];

type Values = { name: string; kind: OrganizationKind; contactName: string; billingEmail: string; phone: string; country: string; timezone: string };

/** Paso 3: dónde se contrata (espacio existente o nueva organización) y datos del responsable. */
export function OrganizationStepForm({
  workspaces,
  planCode,
  interval,
  defaults,
  timezones,
}: {
  workspaces: WorkspaceChoice[];
  planCode: string;
  interval: BillingInterval;
  defaults: { contactName: string; billingEmail: string };
  timezones: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveOrganizationStep, null);
  const firstEligible = workspaces.find((w) => !w.blockedReason);
  const [choice, setChoice] = useState<string>(firstEligible?.id ?? "new");
  const valuesFor = (id: string): Values => {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return { name: "", kind: "clinic", contactName: defaults.contactName, billingEmail: defaults.billingEmail, phone: "", country: "MX", timezone: "America/Mexico_City" };
    return { name: w.name.replace(/ \(demo\)$/, ""), kind: w.kind, timezone: w.timezone, ...w.prefill };
  };
  const [values, setValues] = useState<Values>(() => valuesFor(firstEligible?.id ?? "new"));
  const bind = (key: keyof Values) => ({ value: values[key], onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })) });
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const isNew = choice === "new";

  return (
    <form
      noValidate
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="mode" value={isNew ? "new" : "existing"} />
      <input type="hidden" name="workspaceId" value={isNew ? "" : choice} />
      <input type="hidden" name="planCode" value={planCode} />
      <input type="hidden" name="interval" value={interval} />
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}

      <fieldset>
        <legend className="mb-3 text-base font-semibold text-ink">¿Dónde se usará la suscripción?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => {
            const disabled = Boolean(w.blockedReason);
            const checked = choice === w.id;
            return (
              <label
                key={w.id}
                className={`flex gap-3 rounded-xl border p-4 text-sm transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] ${
                  disabled ? "cursor-not-allowed border-line bg-sunken/60 text-muted" : checked ? "cursor-pointer border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "cursor-pointer border-line-strong bg-surface hover:bg-sunken"
                }`}
              >
                <input
                  type="radio"
                  name="choice"
                  value={w.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    setChoice(w.id);
                    setValues(valuesFor(w.id));
                  }}
                  className="mt-0.5 accent-brand-700"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-semibold text-ink">
                    <Building2 className="size-4 shrink-0 text-brand-700" aria-hidden />
                    <span className="truncate">{w.name}</span>
                  </span>
                  <span className="mt-0.5 block text-xs">{w.blockedReason ?? w.hint}</span>
                </span>
              </label>
            );
          })}
          <label
            className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-sm transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] ${
              isNew ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-dashed border-line-strong bg-surface hover:bg-sunken"
            }`}
          >
            <input
              type="radio"
              name="choice"
              value="new"
              checked={isNew}
              onChange={() => {
                setChoice("new");
                setValues(valuesFor("new"));
              }}
              className="mt-0.5 accent-brand-700"
            />
            <span>
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <Plus className="size-4 text-brand-700" aria-hidden />
                Crear una nueva organización
              </span>
              <span className="mt-0.5 block text-xs text-muted">Un espacio nuevo, independiente de cualquier otro.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <section aria-labelledby="datos-organizacion" className="space-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="datos-organizacion" className="text-base font-semibold text-ink">
          {isNew ? "Datos de la nueva organización" : "Datos de facturación de la organización"}
        </h2>
        <TextField label="Nombre de la organización o clínica" name="name" required autoComplete="organization" error={fe.name} {...bind("name")} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Tipo de establecimiento</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(KIND_LABEL) as OrganizationKind[]).map((k) => (
              <label
                key={k}
                className={`cursor-pointer rounded-xl border p-3 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] ${
                  values.kind === k ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line-strong bg-surface hover:bg-sunken"
                }`}
              >
                <input type="radio" name="kind" value={k} checked={values.kind === k} onChange={() => setValues((v) => ({ ...v, kind: k }))} className="sr-only" />
                <span className="font-semibold">{KIND_LABEL[k]}</span>
              </label>
            ))}
          </div>
          {fe.kind ? <p className="mt-1 text-sm font-medium text-red-700">{fe.kind}</p> : null}
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Nombre del responsable" name="contactName" required autoComplete="name" error={fe.contactName} {...bind("contactName")} />
          <TextField label="Correo administrativo" name="billingEmail" type="email" required autoComplete="email" hint="Aquí llegarán los avisos de facturación." error={fe.billingEmail} {...bind("billingEmail")} />
          <TextField label="Teléfono de contacto" name="phone" type="tel" required autoComplete="tel" error={fe.phone} {...bind("phone")} />
          <Field label="País" error={fe.country}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} name="country" autoComplete="country" {...bind("country")}>
                {COUNTRIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Zona horaria" className="sm:col-span-2" hint={isNew ? "Las horas de la agenda usarán esta zona." : "Se usa para fechas de renovación y avisos."} error={fe.timezone}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} name="timezone" {...bind("timezone")}>
                {timezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-xs text-muted">La suscripción pertenece a la organización: si cambia el responsable, el plan y el historial se conservan.</p>
      </section>

      <div className="flex justify-end">
        <Button type="submit" pending={pending} className="w-full sm:w-auto">
          Continuar al resumen
        </Button>
      </div>
    </form>
  );
}
