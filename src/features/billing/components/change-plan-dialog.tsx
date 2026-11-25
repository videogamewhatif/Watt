"use client";

import { ArrowDownRight, ArrowUpRight, Check, Minus, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { applyPlanChange, type PreviewDTO, previewPlanChange } from "../actions";
import { limitNoun } from "../entitlements";
import { formatCents, INTERVAL_UNIT, type Quote } from "../pricing";
import { featureLabel } from "../presenter";
import type { BillingInterval } from "../types";
import { BillingIntervalToggle } from "./billing-interval-toggle";

export type PlanOption = { code: string; name: string; tier: number; quotes: Record<BillingInterval, Quote | null> };

const dateFmt = (iso: string, tz: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: tz }).format(new Date(iso));

/** Subir, bajar o cambiar periodicidad, con vista previa de diferencias antes de confirmar. */
export function ChangePlanDialog({
  open,
  onClose,
  organizationId,
  plans,
  currentPlanCode,
  currentInterval,
  discountBps,
  timezone,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  plans: PlanOption[];
  currentPlanCode: string;
  currentInterval: BillingInterval;
  discountBps: number;
  timezone: string;
}) {
  const { notify } = useToast();
  const [plan, setPlan] = useState(currentPlanCode);
  const [period, setPeriod] = useState<BillingInterval>(currentInterval);
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const unchanged = plan === currentPlanCode && period === currentInterval;

  useEffect(() => {
    if (!open || unchanged) return;
    let cancelled = false;
    startLoading(async () => {
      const result = await previewPlanChange(organizationId, plan, period);
      if (cancelled) return;
      if (result.ok) {
        setPreview(result.data);
        setError(null);
      } else {
        setPreview(null);
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, plan, period, organizationId, unchanged]);

  const shown = unchanged ? null : preview;

  const confirm = () =>
    startSaving(async () => {
      const result = await applyPlanChange(organizationId, plan, period);
      if (result.ok) {
        notify(result.message);
        onClose();
      } else setError(result.error);
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cambiar plan"
      description="Revisa las diferencias antes de confirmar. Nada se elimina al cambiar de plan."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Volver
          </Button>
          <Button onClick={confirm} pending={saving} disabled={!shown || Boolean(shown.blocked) || loading}>
            {shown?.immediate ? "Confirmar cambio" : "Programar cambio"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex justify-center">
          <BillingIntervalToggle value={period} onChange={setPeriod} discountBps={discountBps} />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Plan</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {plans.map((p) => {
              const q = p.quotes[period];
              const checked = p.code === plan;
              return (
                <label
                  key={p.code}
                  className={`cursor-pointer rounded-xl border p-3 text-sm transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--color-focus)] ${
                    checked ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line-strong bg-surface hover:bg-sunken"
                  }`}
                >
                  <input type="radio" name="plan" value={p.code} checked={checked} onChange={() => setPlan(p.code)} className="sr-only" />
                  <span className="flex items-center justify-between gap-2 font-semibold text-ink">
                    {p.name}
                    {p.code === currentPlanCode ? <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted">Actual</span> : null}
                  </span>
                  {q ? (
                    <span className="tabular mt-1 block text-ink-soft">
                      {formatCents(q.periodPriceCents)} / {INTERVAL_UNIT[period]}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div aria-live="polite" className="min-h-24">
          {unchanged ? (
            <p className="rounded-xl bg-canvas p-4 text-sm text-muted">Elige otro plan o periodicidad para ver las diferencias.</p>
          ) : loading && !shown ? (
            <Spinner label="Calculando diferencias…" />
          ) : error ? (
            <Alert tone="error">{error}</Alert>
          ) : shown ? (
            <div className="space-y-4">
              {shown.blocked ? <Alert tone="warning">{shown.blocked}</Alert> : null}
              <div className={`flex items-start gap-3 rounded-xl p-4 text-sm ${shown.kind === "upgrade" ? "bg-emerald-50 text-emerald-950" : "bg-sky-50 text-sky-950"}`}>
                {shown.kind === "upgrade" ? <ArrowUpRight className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ArrowDownRight className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <div>
                  <p className="font-semibold">
                    {shown.kind === "upgrade" ? "Mejora" : "Reducción"}: {shown.currentPlan.name} → {shown.targetPlan.name}
                  </p>
                  <p className="mt-0.5">
                    {shown.immediate ? "Se aplica de inmediato." : `Entra en vigor el ${dateFmt(shown.effectiveAt, timezone)}, al terminar el periodo que ya pagaste. Hasta entonces conservas tu plan actual.`}
                  </p>
                  {shown.proration ? (
                    <p className="mt-1">
                      Hoy se cobrará <span className="tabular font-semibold">{formatCents(shown.proration.amountDueCents)}</span> (simulado): diferencia proporcional
                      {shown.proration.restartsPeriod ? " con crédito por lo no usado; el nuevo periodo empieza hoy." : ` por el ${Math.round(shown.proration.remainingFraction * 100)} % restante del periodo.`}
                    </p>
                  ) : shown.immediate ? (
                    <p className="mt-1">Sin cargo adicional ahora.</p>
                  ) : shown.newPeriodPriceCents !== null ? (
                    <p className="mt-1">Desde entonces pagarás {formatCents(shown.newPeriodPriceCents)} por {INTERVAL_UNIT[shown.targetInterval]}.</p>
                  ) : null}
                </div>
              </div>

              {shown.limitWarnings.length ? (
                <Alert tone="warning" title="Superarás los límites del nuevo plan">
                  <ul className="list-disc space-y-1 pl-4">
                    {shown.limitWarnings.map((w) => (
                      <li key={w.code}>
                        Tienes {w.usage} {limitNoun(w.code, w.usage)} y el plan {shown.targetPlan.name} permite {w.limit}.
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2">
                    No se borrará ningún usuario, profesional, paciente ni cita. Al entrar en vigor no podrás agregar más hasta quedar dentro del límite; lo existente sigue funcionando.
                  </p>
                </Alert>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink">Ganas</p>
                  {shown.gained.length ? (
                    <ul className="space-y-1.5 text-sm text-ink-soft">
                      {shown.gained.map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
                          {featureLabel(f)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Sin funciones nuevas.</p>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink">Dejas de tener</p>
                  {shown.lost.length ? (
                    <ul className="space-y-1.5 text-sm text-ink-soft">
                      {shown.lost.map((f) => (
                        <li key={f} className="flex gap-2">
                          <Minus className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden />
                          {featureLabel(f)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">No pierdes funciones.</p>
                  )}
                </div>
              </div>
              {shown.lost.length && !shown.immediate ? (
                <p className="flex gap-2 text-xs text-muted">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden />
                  Las funciones que dejas de tener se restringen al entrar en vigor el cambio. La información que generaste con ellas se conserva.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
