"use client";

import { CreditCard, Plus, RefreshCcw, Star, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { addDemoPaymentMethod, removePaymentMethod, setDefaultPaymentMethod } from "../actions";
import type { TestCard } from "../test-cards";
import type { PaymentMethodRow } from "../types";

/**
 * Métodos de pago de DEMOSTRACIÓN: solo tarjetas ficticias (marca y terminación).
 * No hay campos para escribir números de tarjeta. En producción esta sección
 * delegará en el portal seguro de la pasarela.
 */
export function PaymentMethodsPanel({ organizationId, methods, cards, hasActiveSubscription }: { organizationId: string; methods: PaymentMethodRow[]; cards: TestCard[]; hasActiveSubscription: boolean }) {
  const { notify } = useToast();
  const [picker, setPicker] = useState<null | "add" | "update">(null);
  const [toRemove, setToRemove] = useState<PaymentMethodRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) {
        notify(r.message ?? "Listo.");
        after?.();
      } else setError(r.error ?? "No se pudo completar la operación.");
    });

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Modo demostración">
        Solo puedes elegir tarjetas de prueba ficticias. Wattalis nunca pide ni guarda números de tarjeta, CVV ni datos bancarios: en producción las tarjetas se gestionarán en el portal
        seguro de la pasarela de pagos.
      </Alert>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {methods.length ? (
        <ul className="space-y-3">
          {methods.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4">
              <span className="flex h-10 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-brand-800 to-brand-600 text-white" aria-hidden>
                <CreditCard className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">
                  Tarjeta de prueba {m.brand} terminación {m.last4}
                  {m.is_default ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">Predeterminada</span> : null}
                </p>
                <p className="text-sm text-muted">
                  Vence {String(m.exp_month).padStart(2, "0")}/{m.exp_year} · {m.demo_behavior === "approve" ? "la pasarela simulada aprueba sus cobros" : "la pasarela simulada rechaza sus cobros"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!m.is_default ? (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setDefaultPaymentMethod(organizationId, m.id))} icon={<Star className="size-4" aria-hidden />}>
                    Hacer predeterminada
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setToRemove(m)} icon={<Trash2 className="size-4" aria-hidden />} aria-label={`Eliminar tarjeta terminación ${m.last4}`}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">No hay métodos de pago guardados. {hasActiveSubscription ? "La próxima renovación no podrá cobrarse." : ""}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setPicker("add")} icon={<Plus className="size-4" aria-hidden />}>
          Agregar método de pago
        </Button>
        {methods.length ? (
          <Button variant="secondary" onClick={() => setPicker("update")} icon={<RefreshCcw className="size-4" aria-hidden />}>
            Actualizar método
          </Button>
        ) : null}
      </div>

      <Dialog open={picker !== null} onClose={() => setPicker(null)} title={picker === "update" ? "Actualizar método de pago" : "Agregar método de pago"} description="Elige una tarjeta de prueba. Quedará como predeterminada." size="sm">
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => addDemoPaymentMethod(organizationId, c.key), () => setPicker(null))}
                className="flex w-full items-center gap-3 rounded-xl border border-line-strong p-3 text-left text-sm hover:border-brand-400 hover:bg-brand-50 disabled:opacity-60"
              >
                <CreditCard className="size-5 shrink-0 text-brand-700" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">
                    {c.brand} ···· {c.last4}
                  </span>
                  <span className="block text-xs text-muted">{c.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>

      <ConfirmDialog
        open={toRemove !== null}
        title="¿Eliminar este método de pago?"
        confirmLabel="Eliminar"
        pending={pending}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && run(() => removePaymentMethod(organizationId, toRemove.id), () => setToRemove(null))}
      >
        <p>
          Tarjeta de prueba {toRemove?.brand} terminación {toRemove?.last4}.
          {toRemove?.is_default && methods.length > 1 ? " Otra tarjeta guardada quedará como predeterminada." : ""}
          {methods.length === 1 && hasActiveSubscription ? " Sin un método de pago, la próxima renovación no podrá cobrarse." : ""}
        </p>
      </ConfirmDialog>
    </div>
  );
}
