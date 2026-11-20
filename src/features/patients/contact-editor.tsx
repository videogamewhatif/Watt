"use client";

import { Users } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { type ContactSummary, createContact, findSimilarContacts, updateContact } from "./actions";

type Props = {
  organizationId: string;
  initial?: Partial<ContactSummary>;
  /** Si se edita un contacto existente. */
  contactId?: string;
  submitLabel?: string;
  onSaved: (contact: ContactSummary) => void;
  onCancel?: () => void;
  /** Permite elegir un posible duplicado en lugar de crear uno nuevo. */
  onUseExisting?: (contact: ContactSummary) => void;
};

/**
 * Captura de nombre, teléfono y correo con sugerencias de posibles duplicados.
 * No es un <form> para poder usarse dentro de otro formulario (la cita) sin perder datos.
 */
export function ContactEditor({ organizationId, initial, contactId, submitLabel = "Guardar contacto", onSaved, onCancel, onUseExisting }: Props) {
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<ContactSummary[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const enoughData = fullName.trim().length >= 3 || phone.replace(/\D/g, "").length >= 7 || email.includes("@");
    if (!enoughData) return;
    const timer = setTimeout(async () => {
      const found = await findSimilarContacts({ organizationId, fullName, phone, email, excludeId: contactId });
      setSimilar(found);
    }, 400);
    return () => clearTimeout(timer);
  }, [organizationId, fullName, phone, email, contactId]);

  const save = () =>
    startTransition(async () => {
      setFormError(null);
      const input = { organizationId, fullName, phone, email };
      const result = contactId ? await updateContact({ ...input, id: contactId }) : await createContact(input);
      if (result.ok) {
        setErrors({});
        onSaved(result.data);
      } else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
      }
    });

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        // Dentro del formulario de la cita, Enter guarda el contacto y no envía la cita.
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          if (!pending) save();
        }
      }}
    >
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField label="Nombre completo" required value={fullName} onChange={(e) => setFullName(e.target.value)} error={errors.fullName} autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Teléfono"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          autoComplete="off"
          hint="Teléfono o correo: al menos uno."
        />
        <TextField label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="off" />
      </div>
      {similar.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-semibold text-amber-950">
            <Users className="size-4" aria-hidden /> ¿Es alguna de estas personas?
          </p>
          <p className="mt-0.5 text-amber-900">Revisa antes de registrar a alguien nuevo. No se fusiona nada automáticamente.</p>
          <ul className="mt-2 space-y-1.5">
            {similar.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{c.full_name}</span>
                  <span className="block text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                </span>
                {onUseExisting ? (
                  <Button size="sm" variant="secondary" onClick={() => onUseExisting(c)}>
                    Usar este contacto
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} pending={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
