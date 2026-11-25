"use client";

import { ArrowLeftRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { parseMoney } from "@/lib/money";
import { addCashMovement } from "../actions";

export function MovementDialog({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openDialog = () => {
    setKind("out");
    setAmount("");
    setConcept("");
    setErrors({});
    setError(null);
    setOpen(true);
  };

  const submit = () => {
    const value = parseMoney(amount);
    if (value === null || value <= 0) {
      setErrors({ amount: "Escribe un monto mayor a cero." });
      return;
    }
    startTransition(async () => {
      const result = await addCashMovement({ organizationId, kind, amount: value, concept });
      if (result.ok) {
        setOpen(false);
        notify(result.message ?? "Movimiento registrado.");
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        setError(result.fieldErrors ? null : result.error);
      }
    });
  };

  return (
    <>
      <Button variant="secondary" onClick={openDialog} icon={<ArrowLeftRight className="size-4" aria-hidden />}>
        Entrada / salida
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Movimiento de efectivo"
        description="Registra dinero que entra o sale de la caja sin ser un cobro: gastos, retiros, cambio."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button pending={pending} onClick={submit}>
              Registrar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Tipo</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["out", "Salida"],
                  ["in", "Entrada"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium ${kind === value ? "border-brand-700 bg-brand-50 text-brand-900" : "border-line-strong"}`}>
                  <input type="radio" name="kind" className="sr-only" checked={kind === value} onChange={() => setKind(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <TextField label="Monto (MXN)" required inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} className="max-w-48" />
          <TextField
            label="Concepto"
            required
            maxLength={160}
            placeholder={kind === "out" ? "Ej. compra de papelería" : "Ej. fondo de cambio"}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            error={errors.concept}
          />
        </div>
      </Dialog>
    </>
  );
}
