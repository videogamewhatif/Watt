"use client";

import { Lock } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { confirmOrder } from "../actions";
import type { BillingInterval } from "../types";

/** Aceptación explícita de términos y paso a la pasarela. Un doble clic no crea dos sesiones. */
export function ConfirmOrderForm({ workspaceId, planCode, interval, totalLabel }: { workspaceId: string; planCode: string; interval: BillingInterval; totalLabel: string }) {
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await confirmOrder({ workspaceId, planCode, interval, acceptedTerms: accepted, idempotencyKey });
          if (result && !result.ok) setError(result.error);
        });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <details className="rounded-xl border border-line bg-surface p-4 text-sm [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer font-medium text-brand-700">Leer los términos de la suscripción</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-soft">
          <li>La suscripción es de la organización elegida, no de una persona.</li>
          <li>Se renueva automáticamente al final de cada periodo por el mismo importe, salvo que la canceles o cambies de plan.</li>
          <li>Puedes cancelar en cualquier momento: conservas el acceso hasta el final del periodo pagado y no hay reembolsos parciales.</li>
          <li>Una mejora se cobra de forma proporcional al momento; una reducción se aplica al terminar el periodo.</li>
          <li>Si un pago no se procesa hay un periodo de gracia; después el espacio queda en modo de consulta. Nunca se borra tu información.</li>
          <li>Los comprobantes de esta demostración no tienen validez fiscal (no son CFDI).</li>
        </ul>
        <p className="mt-3 text-xs text-muted">Texto de demostración. El contrato definitivo se publicará con los términos y condiciones aprobados.</p>
      </details>
      <label className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface p-4 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)]">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required className="mt-0.5 size-4 shrink-0 accent-brand-700" aria-describedby="terminos-ayuda" />
        <span>
          <span className="font-medium text-ink">Acepto los términos y condiciones de la suscripción y la renovación automática.</span>
          <span id="terminos-ayuda" className="mt-0.5 block text-muted">
            Requerido para continuar.
          </span>
        </span>
      </label>
      <Button type="submit" pending={pending} disabled={!accepted} className="w-full" icon={<Lock className="size-4" aria-hidden />}>
        Continuar al pago · {totalLabel}
      </Button>
      <p className="text-center text-xs text-muted">Te llevaremos a la pasarela de pago. Wattalis nunca recibe ni guarda los datos de tu tarjeta.</p>
    </form>
  );
}
