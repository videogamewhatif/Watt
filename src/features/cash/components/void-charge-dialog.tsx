"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { voidCharge } from "../actions";

export function VoidChargeDialog({ organizationId, chargeId, folio, total }: { organizationId: string; chargeId: string; folio: number; total: number }) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Cancelar el cobro #${folio}`}
        onClick={() => {
          setReason("");
          setErrors({});
          setError(null);
          setOpen(true);
        }}
        icon={<Ban className="size-4" aria-hidden />}
      >
        Cancelar
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Cancelar cobro #${folio}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Volver
            </Button>
            <Button
              variant="danger"
              pending={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await voidCharge({ organizationId, chargeId, reason });
                  if (result.ok) {
                    setOpen(false);
                    notify(result.message ?? "Cobro cancelado.");
                    router.refresh();
                  } else {
                    setErrors(result.fieldErrors ?? {});
                    setError(result.fieldErrors ? null : result.error);
                  }
                })
              }
            >
              Cancelar cobro
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Alert tone="warning">
            Se anulan los {formatMoney(total)} de este cobro y dejan de contar en el corte. El cobro no se borra: queda en el historial con tu nombre y el motivo. Solo se puede hacer antes de cerrar el turno.
          </Alert>
          <Field label="Motivo" required error={errors.reason}>
            {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
