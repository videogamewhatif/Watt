"use client";

import { Ban, CircleCheck, Clock, CreditCard, FlaskConical, Landmark, Store, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { simulatePayment } from "../actions";

type Outcome = "approved" | "declined" | "pending" | "canceled";

const METHODS = [
  { key: "card", label: "Tarjeta de crédito o débito", hint: "En producción se abrirá la página segura de la pasarela.", Icon: CreditCard, available: true },
  { key: "spei", label: "Transferencia SPEI", hint: "Próximamente", Icon: Landmark, available: false },
  { key: "cash", label: "Pago en efectivo en tienda", hint: "Próximamente", Icon: Store, available: false },
];

/**
 * Pantalla de pago SIMULADA. No tiene campos de tarjeta: nunca se capturan,
 * guardan ni procesan números, CVV ni datos bancarios. La persona elige qué
 * respuesta devolverá la pasarela de demostración.
 */
export function DemoPaymentForm({ sessionId, totalLabel, allowCancel = true, outcomes = ["approved", "declined", "pending"] }: { sessionId: string; totalLabel: string; allowCancel?: boolean; outcomes?: Outcome[] }) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (outcome: Outcome) => {
    setError(null);
    setRunning(outcome);
    startTransition(async () => {
      const result = await simulatePayment(sessionId, outcome);
      if (result && !result.ok) setError(result.error);
      setRunning(null);
    });
  };

  return (
    <div className="space-y-6">
      <div role="status" className="flex items-start gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950">
        <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Modo demostración. No se realizará ningún cargo.</p>
          <p className="mt-0.5 text-sm">No escribas datos reales de tarjeta: esta pantalla no tiene campos para hacerlo. Elige el resultado que quieres simular.</p>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Método de pago</legend>
        <div className="space-y-2">
          {METHODS.map(({ key, label, hint, Icon, available }) => (
            <label
              key={key}
              className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${available ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "cursor-not-allowed border-line bg-sunken/60 text-muted"}`}
            >
              <input type="radio" name="method" value={key} defaultChecked={available} disabled={!available} className="accent-brand-700" />
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block text-xs">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div aria-hidden className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-800 to-brand-600 p-5 text-white shadow-lg">
        <div className="flex items-center justify-between text-xs font-medium tracking-wide text-brand-100 uppercase">
          <span>Tarjeta de prueba</span>
          <span>Pasarela simulada</span>
        </div>
        <p className="tabular mt-6 text-lg tracking-[0.2em]">•••• •••• •••• 4242</p>
        <div className="mt-4 flex justify-between text-xs text-brand-100">
          <span>DEMOSTRACIÓN</span>
          <span>12/30</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {outcomes.includes("approved") ? (
          <Button onClick={() => run("approved")} pending={pending && running === "approved"} disabled={pending} icon={<CircleCheck className="size-4" aria-hidden />} className="sm:col-span-2">
            Simular pago aprobado · {totalLabel}
          </Button>
        ) : null}
        {outcomes.includes("declined") ? (
          <Button variant="secondary" onClick={() => run("declined")} pending={pending && running === "declined"} disabled={pending} icon={<XCircle className="size-4" aria-hidden />}>
            Simular pago rechazado
          </Button>
        ) : null}
        {outcomes.includes("pending") ? (
          <Button variant="secondary" onClick={() => run("pending")} pending={pending && running === "pending"} disabled={pending} icon={<Clock className="size-4" aria-hidden />}>
            Simular pago pendiente
          </Button>
        ) : null}
        {allowCancel ? (
          <Button variant="ghost" onClick={() => run("canceled")} pending={pending && running === "canceled"} disabled={pending} icon={<Ban className="size-4" aria-hidden />} className="sm:col-span-2">
            Cancelar y volver al resumen
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Al conectar la pasarela real (por ejemplo, Stripe Checkout), este paso se sustituye por su página de pago alojada. Wattalis solo recibirá la confirmación firmada del resultado.
      </p>
    </div>
  );
}
