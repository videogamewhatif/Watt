"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { undoCancellation } from "../actions";
import { CancelSubscriptionDialog } from "./cancel-subscription-dialog";

/** Renovación automática activada/desactivada. Desactivar pasa por el diálogo de cancelación (claro y reversible). */
export function RenewalToggle({ organizationId, enabled, canChange, planName, accessUntilLabel }: { organizationId: string; enabled: boolean; canChange: boolean; planName: string; accessUntilLabel: string | null }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${enabled ? "bg-emerald-50 text-emerald-900 ring-emerald-300" : "bg-stone-100 text-stone-700 ring-stone-300"}`}
        >
          <span aria-hidden className={`size-2 rounded-full ${enabled ? "bg-emerald-600" : "bg-stone-500"}`} />
          {enabled ? "Activada" : "Desactivada"}
        </span>
        {canChange ? (
          enabled ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Desactivar renovación
            </Button>
          ) : (
            <Button
              size="sm"
              pending={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await undoCancellation(organizationId);
                  if (r.ok) notify(r.message);
                  else setError(r.error);
                })
              }
            >
              Reactivar renovación
            </Button>
          )
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <CancelSubscriptionDialog open={open} onClose={() => setOpen(false)} organizationId={organizationId} planName={planName} accessUntilLabel={accessUntilLabel} immediate={false} />
    </div>
  );
}
