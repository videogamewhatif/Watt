"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Textarea, TextField } from "@/components/ui/field";
import { submitSalesLead } from "../actions";

/** Solicitud de propuesta para el plan Corporativo. */
export function SalesLeadForm() {
  const [state, action, pending] = useActionState(submitSalesLead, null);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  if (state?.ok) return <Alert tone="success" title="Solicitud enviada">{state.message}</Alert>;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      {state && !state.ok ? (
        <div className="sm:col-span-2">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      <TextField label="Nombre" name="name" autoComplete="name" required error={fe.name} />
      <TextField label="Correo de trabajo" name="email" type="email" autoComplete="email" required error={fe.email} />
      <TextField label="Hospital o grupo médico" name="organization" autoComplete="organization" required error={fe.organization} />
      <TextField label="Número de sedes o espacios" name="workspaces" type="number" min={1} max={500} defaultValue={3} required error={fe.workspaces} />
      <Field label="¿Qué necesitas?" className="sm:col-span-2" hint="Opcional. Integraciones, número de usuarios, condiciones de facturación…">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} name="message" rows={3} maxLength={1000} />}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" pending={pending}>
          Solicitar propuesta
        </Button>
      </div>
    </form>
  );
}
