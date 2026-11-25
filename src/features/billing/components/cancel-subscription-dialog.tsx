"use client";

import { CalendarX, Database, RotateCcw, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cancelSubscription } from "../actions";

const REASONS = ["El precio no se ajusta a mi presupuesto", "No uso todas las funciones", "Cambiaré a otro sistema", "Cierre temporal o definitivo", "Problemas técnicos", "Otro motivo"];

/**
 * Cancelación clara: qué pasa, hasta cuándo hay acceso, qué pasa con la
 * información y cómo reactivar. Ambos botones tienen el mismo peso visual.
 */
export function CancelSubscriptionDialog({
  open,
  onClose,
  organizationId,
  planName,
  accessUntilLabel,
  immediate,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  planName: string;
  accessUntilLabel: string | null;
  /** Suscripción en impago: la cancelación es inmediata (no hay periodo pagado que conservar). */
  immediate: boolean;
}) {
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      const text = [reason, comment.trim()].filter(Boolean).join(" — ") || null;
      const result = await cancelSubscription(organizationId, text);
      if (result.ok) {
        notify(result.message);
        onClose();
      } else setError(result.error);
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={immediate ? "Cancelar suscripción" : "Cancelar la renovación"}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Conservar mi plan
          </Button>
          <Button variant="danger" onClick={confirm} pending={pending}>
            {immediate ? "Cancelar suscripción" : "Cancelar renovación"}
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="text-ink-soft">
          Plan actual: <span className="font-semibold text-ink">{planName}</span>
        </p>
        <ul className="space-y-3">
          <li className="flex gap-3">
            <CalendarX className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            <span>
              <span className="font-medium text-ink">{immediate ? "Termina hoy." : `Conservas el acceso hasta el ${accessUntilLabel}.`}</span>{" "}
              {immediate ? "No se harán más cobros." : "No se hará ningún otro cobro y hasta esa fecha todo funciona igual."}
            </span>
          </li>
          <li className="flex gap-3">
            <Database className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            <span>
              <span className="font-medium text-ink">Tu información no se borra.</span> Pacientes, citas, cobros, usuarios y reportes se conservan. Después del vencimiento el espacio queda en
              modo de consulta: puedes verlo todo y exportar los reportes en CSV.
            </span>
          </li>
          <li className="flex gap-3">
            <RotateCcw className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            <span>
              <span className="font-medium text-ink">Puedes volver cuando quieras.</span> {immediate ? "Reactiva un plan desde esta misma sección." : "Deshaz la cancelación antes del vencimiento con un clic, o reactiva un plan después."}
            </span>
          </li>
          <li className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            <span>La conservación y exportación de datos seguirán la política de retención aplicable a expedientes y registros administrativos.</span>
          </li>
        </ul>
        <div className="space-y-3 rounded-xl border border-line bg-canvas p-4">
          <Field label="¿Nos cuentas por qué? (opcional)">
            {({ id }) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Prefiero no decirlo</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Comentario (opcional)">
            {({ id }) => <Textarea id={id} rows={2} maxLength={400} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
