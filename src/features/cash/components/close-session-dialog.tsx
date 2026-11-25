"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatMoney, parseMoney, toCents } from "@/lib/money";
import { type CloseResult, closeCashSession } from "../actions";

type Props = {
  organizationId: string;
  sessionId: string;
  expectedCash: number;
  summary: { opening: number; cashSales: number; movementsIn: number; movementsOut: number };
};

export function CloseSessionDialog({ organizationId, sessionId, expectedCash, summary }: Props) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);
  const [pending, startTransition] = useTransition();

  const value = counted.trim() === "" ? null : parseMoney(counted);
  const difference = value === null ? null : (toCents(value) - toCents(expectedCash)) / 100;
  const needsNote = difference !== null && difference !== 0;

  const row = (label: string, amount: number, sign = "") => (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>
        {sign}
        {formatMoney(amount)}
      </dd>
    </div>
  );

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setCounted("");
          setNotes("");
          setErrors({});
          setError(null);
          setResult(null);
          setOpen(true);
        }}
        icon={<Lock className="size-4" aria-hidden />}
      >
        Cerrar caja
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={result ? "Caja cerrada" : "Corte de caja"}
        footer={
          result ? (
            <>
              <Link className="text-sm font-medium text-brand-700 underline underline-offset-2" href={`/ventas/turnos/${sessionId}`}>
                Ver el detalle del turno
              </Link>
              <Button onClick={() => setOpen(false)}>Listo</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                pending={pending}
                onClick={() => {
                  if (value === null) {
                    setErrors({ countedAmount: "Escribe el efectivo contado (puede ser 0)." });
                    return;
                  }
                  if (needsNote && notes.trim().length === 0) {
                    setErrors({ notes: "Explica la diferencia para poder cerrar." });
                    return;
                  }
                  startTransition(async () => {
                    const res = await closeCashSession({ organizationId, sessionId, countedAmount: value, notes });
                    if (res.ok) {
                      setResult(res.data);
                      notify(res.message ?? "Caja cerrada.");
                      router.refresh();
                    } else {
                      setErrors(res.fieldErrors ?? {});
                      setError(res.error);
                    }
                  });
                }}
              >
                Cerrar turno
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-4">
            <dl className="tabular space-y-1 text-sm">
              {row("Efectivo esperado", result.expected)}
              {row("Efectivo contado", result.counted)}
            </dl>
            {result.difference === 0 ? (
              <Alert tone="success" title="La caja cuadra">
                No hay diferencia entre lo contado y lo esperado.
              </Alert>
            ) : (
              <Alert tone="warning" title={`${result.difference > 0 ? "Sobrante" : "Faltante"} de ${formatMoney(Math.abs(result.difference))}`}>
                Quedó registrado en el corte junto con tu nota.
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {error && !errors.notes && !errors.countedAmount ? <Alert tone="error">{error}</Alert> : null}
            <dl className="tabular space-y-1 rounded-lg bg-sunken px-3 py-3 text-sm">
              {row("Fondo inicial", summary.opening)}
              {row("Cobros en efectivo", summary.cashSales, "+")}
              {row("Entradas", summary.movementsIn, "+")}
              {row("Salidas", summary.movementsOut, "−")}
              <div className="flex justify-between gap-4 border-t border-line-strong pt-1 font-semibold">
                <dt>Efectivo esperado</dt>
                <dd>{formatMoney(expectedCash)}</dd>
              </div>
            </dl>
            <TextField
              label="Efectivo contado en caja (MXN)"
              required
              inputMode="decimal"
              placeholder="0.00"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              error={errors.countedAmount ?? (counted !== "" && value === null ? "Escribe un importe válido." : undefined)}
              hint="Cuenta billetes y monedas. Tarjeta y transferencias no se cuentan aquí."
            />
            <div aria-live="polite" className="text-sm">
              {difference === null ? null : difference === 0 ? (
                <p className="font-medium text-emerald-800">La caja cuadra.</p>
              ) : (
                <p className="font-medium text-amber-900">
                  {difference > 0 ? "Sobran" : "Faltan"} {formatMoney(Math.abs(difference))}
                </p>
              )}
            </div>
            <Field label={needsNote ? "Explica la diferencia" : "Nota (opcional)"} required={needsNote} error={errors.notes}>
              {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
            <p className="text-xs text-muted">Al cerrar, el turno ya no admite cobros, cancelaciones ni movimientos.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
