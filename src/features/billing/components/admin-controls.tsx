"use client";

import { Play, RotateCcw, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Input, Select, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { adminResetDemo, adminSimulate, adminUpdateEntitlements, adminUpdatePlan, adminUpdateSettings } from "../actions";
import type { FeatureDef } from "../catalog";
import type { SimulationAction } from "../service";
import type { SubscriptionStatus } from "../types";

type Result = { ok: boolean; error?: string; message?: string };

function useRunner() {
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) {
        notify(r.message ?? "Listo.");
        after?.();
      } else setError(r.error ?? "No se pudo completar la operación.");
    });
  return { pending, error, run };
}

// -----------------------------------------------------------------------------
// Simulaciones por suscripción
// -----------------------------------------------------------------------------
const SIMULATIONS: { value: SimulationAction; label: string; when: SubscriptionStatus[] }[] = [
  { value: "renew_approved", label: "Renovar (pago aprobado)", when: ["active", "trialing"] },
  { value: "renew_declined", label: "Renovar (pago rechazado)", when: ["active", "trialing"] },
  { value: "retry_approved", label: "Reintentar cobro (aprobado)", when: ["past_due", "grace_period", "unpaid"] },
  { value: "retry_declined", label: "Reintentar cobro (rechazado)", when: ["past_due", "grace_period", "unpaid"] },
  { value: "expire_grace", label: "Terminar periodo de gracia", when: ["grace_period"] },
  { value: "notify_renewal", label: "Enviar aviso de renovación próxima", when: ["active"] },
  { value: "notify_trial_ending", label: "Enviar aviso de fin de prueba", when: ["trialing"] },
  { value: "cancel_now", label: "Cancelar de inmediato", when: ["active", "trialing", "past_due", "grace_period", "unpaid", "incomplete"] },
];

export function AdminSimulationMenu({ subscriptionId, status, organization }: { subscriptionId: string; status: SubscriptionStatus; organization: string }) {
  const options = SIMULATIONS.filter((s) => s.when.includes(status));
  const [action, setAction] = useState<SimulationAction | "">(options[0]?.value ?? "");
  const { pending, error, run } = useRunner();
  if (!options.length) return <span className="text-xs text-muted">Sin simulaciones</span>;
  return (
    <div className="flex min-w-56 flex-col gap-1">
      <div className="flex gap-1.5">
        <label className="sr-only" htmlFor={`sim-${subscriptionId}`}>
          Simulación para {organization}
        </label>
        <select
          id={`sim-${subscriptionId}`}
          value={action}
          onChange={(e) => setAction(e.target.value as SimulationAction)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-xs"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" pending={pending} disabled={!action} onClick={() => action && run(() => adminSimulate(subscriptionId, action))} aria-label={`Aplicar simulación a ${organization}`}>
          <Play className="size-3.5" aria-hidden />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Editor de un plan: precio, textos, estado, límites y funciones
// -----------------------------------------------------------------------------
type PlanEditorProps = {
  plan: { id: string; code: string; name: string; description: string; badge: string | null; is_active: boolean; is_custom_pricing: boolean; monthly_price_cents: number | null; annual_price_cents: number | null };
  features: FeatureDef[];
  entitlements: { feature_code: string; enabled: boolean; usage_limit: number | null }[];
};

export function AdminPlanEditor({ plan, features, entitlements }: PlanEditorProps) {
  const { pending, error, run } = useRunner();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [badge, setBadge] = useState(plan.badge ?? "");
  const [price, setPrice] = useState(plan.monthly_price_cents === null ? "" : (plan.monthly_price_cents / 100).toFixed(2));
  const [active, setActive] = useState(plan.is_active);
  const [ents, setEnts] = useState(() =>
    Object.fromEntries(features.map((f) => {
      const e = entitlements.find((x) => x.feature_code === f.code);
      return [f.code, { enabled: Boolean(e?.enabled), limit: e?.usage_limit === null || e?.usage_limit === undefined ? "" : String(e.usage_limit) }];
    })),
  );
  const limits = features.filter((f) => f.kind === "limit");
  const flags = features.filter((f) => f.kind === "feature");

  const save = () =>
    run(async () => {
      const r1 = await adminUpdatePlan(plan.id, { name, description, badge: badge || null, isActive: active, monthlyPrice: plan.is_custom_pricing ? undefined : price });
      if (!r1.ok) return r1;
      const entries = features.map((f) => ({
        feature_code: f.code,
        enabled: f.kind === "limit" ? true : ents[f.code].enabled,
        usage_limit: f.kind === "limit" ? (ents[f.code].limit.trim() === "" ? null : Number(ents[f.code].limit)) : null,
      }));
      if (entries.some((e) => e.usage_limit !== null && (!Number.isInteger(e.usage_limit) || e.usage_limit < 0))) return { ok: false, error: "Los límites deben ser números enteros (vacío = sin límite)." };
      const r2 = await adminUpdateEntitlements(plan.id, entries);
      return r2.ok ? { ok: true, message: `Plan ${name} guardado.` } : r2;
    });

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Etiqueta destacada" hint="Ej. «Más popular». Vacío = sin etiqueta." value={badge} onChange={(e) => setBadge(e.target.value)} />
        <TextField label="Descripción" className="sm:col-span-2" value={description} onChange={(e) => setDescription(e.target.value)} />
        {plan.is_custom_pricing ? (
          <p className="text-sm text-muted sm:col-span-2">Precio personalizado: se pacta por cliente (precio por suscripción).</p>
        ) : (
          <TextField
            label="Precio mensual (MXN)"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            hint={plan.annual_price_cents !== null ? `Anual vigente: $${(plan.annual_price_cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })} (se recalcula con el descuento).` : undefined}
          />
        )}
        <div className="flex items-end">
          <Checkbox label="Plan activo" description="Visible en /precios y contratable." checked={active} onChange={(e) => setActive(e.target.checked)} />
        </div>
      </div>
      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Límites (vacío = sin límite)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {limits.map((f) => (
            <Field key={f.code} label={f.label}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={ents[f.code].limit}
                  onChange={(e) => setEnts((all) => ({ ...all, [f.code]: { ...all[f.code], limit: e.target.value } }))}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Funciones incluidas</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {flags.map((f) => (
            <Checkbox
              key={f.code}
              label={f.label + (f.soon ? " (próximamente)" : "")}
              checked={ents[f.code].enabled}
              onChange={(e) => setEnts((all) => ({ ...all, [f.code]: { ...all[f.code], enabled: e.target.checked } }))}
            />
          ))}
        </div>
      </fieldset>
      <Button onClick={save} pending={pending} icon={<Save className="size-4" aria-hidden />}>
        Guardar plan
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Configuración comercial
// -----------------------------------------------------------------------------
export function AdminSettingsForm({ settings }: { settings: { annual_discount_bps: number; grace_period_days: number; tax_rate_bps: number; prices_include_tax: boolean; trial_days: number; enforce_limits: boolean } }) {
  const { pending, error, run } = useRunner();
  const [discount, setDiscount] = useState(String(settings.annual_discount_bps / 100));
  const [grace, setGrace] = useState(String(settings.grace_period_days));
  const [tax, setTax] = useState(String(settings.tax_rate_bps / 100));
  const [included, setIncluded] = useState(settings.prices_include_tax ? "yes" : "no");
  const [trial, setTrial] = useState(String(settings.trial_days));
  const [enforce, setEnforce] = useState(settings.enforce_limits);
  const num = (v: string) => Number(v.replace(",", "."));
  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Descuento anual (%)" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} hint="Recalcula los precios anuales." />
        <TextField label="Periodo de gracia (días)" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
        <TextField label="Periodo de prueba (días)" inputMode="numeric" value={trial} onChange={(e) => setTrial(e.target.value)} />
        <TextField label="IVA (%)" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
        <Field label="Precios publicados">
          {({ id }) => (
            <Select id={id} value={included} onChange={(e) => setIncluded(e.target.value)}>
              <option value="yes">Con IVA incluido</option>
              <option value="no">Más IVA</option>
            </Select>
          )}
        </Field>
        <div className="flex items-end">
          <Checkbox label="Aplicar límites" description="Si se desactiva, los límites solo se informan." checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
        </div>
      </div>
      <Button
        pending={pending}
        icon={<Save className="size-4" aria-hidden />}
        onClick={() =>
          run(() =>
            adminUpdateSettings({
              annualDiscount: num(discount),
              graceDays: Math.round(num(grace)),
              taxRate: num(tax),
              pricesIncludeTax: included === "yes",
              trialDays: Math.round(num(trial)),
              enforceLimits: enforce,
            }),
          )
        }
      >
        Guardar configuración
      </Button>
    </div>
  );
}

export function AdminResetButton() {
  const { pending, error, run } = useRunner();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button variant="danger" onClick={() => setOpen(true)} icon={<RotateCcw className="size-4" aria-hidden />}>
        Reiniciar datos de demostración
      </Button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <ConfirmDialog open={open} title="¿Reiniciar la facturación de demostración?" confirmLabel="Reiniciar" pending={pending} onClose={() => setOpen(false)} onConfirm={() => run(() => adminResetDemo(), () => setOpen(false))}>
        <p>Vuelve a los planes, precios, clientes y cobros ficticios iniciales. No afecta datos reales (no existen en este modo).</p>
      </ConfirmDialog>
    </div>
  );
}
