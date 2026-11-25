"use client";

import { ArrowUpDown, CreditCard, RefreshCcw, RotateCcw, Settings2, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelScheduledPlanChange, retrySubscriptionPayment, undoCancellation } from "../actions";
import type { SubscriptionAction } from "../state-machine";
import type { BillingInterval, SubscriptionStatus } from "../types";
import { CancelSubscriptionDialog } from "./cancel-subscription-dialog";
import { ChangePlanDialog, type PlanOption } from "./change-plan-dialog";

type Props = {
  organizationId: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  actions: SubscriptionAction[];
  planName: string;
  accessUntilLabel: string | null;
  plans: PlanOption[];
  currentPlanCode: string;
  currentInterval: BillingInterval;
  discountBps: number;
  timezone: string;
  reactivateHref: string;
  manageHref: string;
};

/** Acciones disponibles según el estado (definidas en la máquina de estados). */
export function PlanActions(p: Props) {
  const { notify } = useToast();
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const has = (a: SubscriptionAction) => p.actions.includes(a);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) notify(r.message ?? "Listo.");
      else setError(r.error ?? "No se pudo completar la operación.");
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {has("retry_payment") ? (
          <Button onClick={() => run(() => retrySubscriptionPayment(p.organizationId))} pending={pending} icon={<RefreshCcw className="size-4" aria-hidden />}>
            Reintentar pago
          </Button>
        ) : null}
        {has("complete_checkout") || has("reactivate") ? (
          <Link href={p.reactivateHref} className={buttonClass("primary")}>
            <RotateCcw className="size-4" aria-hidden />
            {has("complete_checkout") ? "Completar contratación" : "Reactivar suscripción"}
          </Link>
        ) : null}
        {has("undo_cancel") && p.cancelAtPeriodEnd ? (
          <Button onClick={() => run(() => undoCancellation(p.organizationId))} pending={pending} icon={<RotateCcw className="size-4" aria-hidden />}>
            Reactivar renovación
          </Button>
        ) : null}
        {has("change_plan") && !p.cancelAtPeriodEnd ? (
          <Button onClick={() => setChangeOpen(true)} icon={<ArrowUpDown className="size-4" aria-hidden />}>
            Cambiar plan
          </Button>
        ) : null}
        {has("update_payment_method") ? (
          <Link href="/configuracion/suscripcion/metodos-de-pago" className={buttonClass("secondary")}>
            <CreditCard className="size-4" aria-hidden />
            {p.status === "past_due" || p.status === "grace_period" || p.status === "unpaid" ? "Actualizar método de pago" : "Métodos de pago"}
          </Link>
        ) : null}
        {has("manage") ? (
          <Link href={p.manageHref} className={buttonClass("secondary")}>
            <Settings2 className="size-4" aria-hidden />
            Administrar suscripción
          </Link>
        ) : null}
        {has("cancel") && !p.cancelAtPeriodEnd ? (
          <Button variant="ghost" onClick={() => setCancelOpen(true)} icon={<XCircle className="size-4" aria-hidden />}>
            {p.status === "unpaid" ? "Cancelar suscripción" : "Cancelar renovación"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {changeOpen ? (
        <ChangePlanDialog
          open={changeOpen}
          onClose={() => setChangeOpen(false)}
          organizationId={p.organizationId}
          plans={p.plans}
          currentPlanCode={p.currentPlanCode}
          currentInterval={p.currentInterval}
          discountBps={p.discountBps}
          timezone={p.timezone}
        />
      ) : null}
      <CancelSubscriptionDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        organizationId={p.organizationId}
        planName={p.planName}
        accessUntilLabel={p.accessUntilLabel}
        immediate={p.status === "unpaid"}
      />
    </div>
  );
}

/** Deshacer un cambio de plan programado. */
export function UndoScheduledChange({ organizationId }: { organizationId: string }) {
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        pending={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await cancelScheduledPlanChange(organizationId);
            if (r.ok) notify(r.message);
            else setError(r.error);
          })
        }
      >
        Deshacer cambio
      </Button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
