"use client";

import { LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { parseMoney } from "@/lib/money";
import { openCashSession } from "../actions";

export function OpenSessionForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const value = amount.trim() === "" ? null : parseMoney(amount);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (value === null) {
          setErrors({ openingAmount: "Escribe el fondo inicial (puede ser 0)." });
          return;
        }
        startTransition(async () => {
          const result = await openCashSession({ organizationId, openingAmount: value, notes });
          if (result.ok) {
            notify(result.message ?? "Caja abierta.");
            router.refresh();
          } else {
            setErrors(result.fieldErrors ?? {});
            setError(result.fieldErrors ? null : result.error);
          }
        });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <TextField
        label="Fondo inicial en efectivo (MXN)"
        required
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={errors.openingAmount}
        hint="El efectivo con el que empieza el turno, por ejemplo para dar cambio."
        className="max-w-60"
      />
      <TextField label="Nota (opcional)" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} />
      <Button type="submit" pending={pending} icon={<LockOpen className="size-4" aria-hidden />}>
        Abrir caja
      </Button>
    </form>
  );
}
