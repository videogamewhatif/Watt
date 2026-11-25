"use client";

import { Banknote, CreditCard, Landmark, Receipt, Split } from "lucide-react";
import { useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import type { PaymentMethod } from "@/lib/database.types";
import { formatMoney, fromCents, PAYMENT_LABEL, parseMoney, settle, toCents } from "@/lib/money";

export type PayMode = "cash" | "card" | "transfer" | "mixed";
export type PayState = { mode: PayMode; received: string; split: string; reference: string };
export const INITIAL_PAY: PayState = { mode: "cash", received: "", split: "", reference: "" };

const MODES: { value: PayMode; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "card", label: "Tarjeta", icon: CreditCard },
  { value: "transfer", label: "Transferencia", icon: Landmark },
  { value: "mixed", label: "Efectivo + tarjeta", icon: Split },
];

export const PAY_VERB: Record<PayMode, string> = {
  cash: "en efectivo",
  card: "con tarjeta",
  transfer: "por transferencia",
  mixed: "con tarjeta y efectivo",
};

/** Billetes con los que suele pagar la gente: el importe redondeado hacia arriba. */
function quickCash(amount: number): number[] {
  const cents = toCents(amount);
  if (cents <= 0) return [];
  const options = [50, 100, 200, 500, 1000].map((bill) => Math.ceil(cents / (bill * 100)) * bill * 100).filter((c) => c > cents);
  return [...new Set(options)].slice(0, 3).map(fromCents);
}

export type ResolvedPayment = {
  payments: { method: PaymentMethod; amount: number; reference: string }[];
  /** Lo que se debe cubrir en efectivo (todo, nada o el resto en pago mixto). */
  cashDue: number;
  change: number;
  due: number;
  problem: string | null;
};

/** Convierte lo capturado en pagos. Lo que excede en efectivo es cambio (no entra a caja). */
export function resolvePayment(total: number, s: PayState): ResolvedPayment {
  let problem: string | null = null;
  const payments: ResolvedPayment["payments"] = [];
  let cashDue = 0;

  if (s.mode === "card" || s.mode === "transfer") {
    payments.push({ method: s.mode, amount: total, reference: s.reference });
  } else {
    cashDue = total;
    if (s.mode === "mixed") {
      const card = parseMoney(s.split);
      if (card === null || card <= 0 || card >= total) {
        problem = s.split === "" ? "Escribe cuánto se paga con tarjeta." : "Lo de tarjeta debe ser mayor a cero y menor al total.";
      } else {
        payments.push({ method: "card", amount: card, reference: s.reference });
        cashDue = fromCents(toCents(total) - toCents(card));
      }
    }
    const received = s.received.trim() === "" ? cashDue : parseMoney(s.received);
    if (received === null) problem ??= "Escribe un importe válido en efectivo.";
    else if (cashDue > 0) payments.push({ method: "cash", amount: received, reference: "" });
  }

  const paid = settle(total, payments);
  if (!problem && paid.due > 0) problem = `Faltan ${formatMoney(paid.due)} en efectivo.`;
  return { payments, cashDue, change: paid.change, due: paid.due, problem };
}

/** Selector de forma de pago dentro del ticket. */
export function PaymentPicker({ total, value, onChange, resolved }: { total: number; value: PayState; onChange: (next: PayState) => void; resolved: ResolvedPayment }) {
  const set = (patch: Partial<PayState>) => onChange({ ...value, ...patch });
  const showCash = value.mode === "cash" || value.mode === "mixed";
  const showReference = value.mode !== "cash";
  const receivedValue = parseMoney(value.received);
  const id = useId();

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Forma de pago</legend>
      <div role="radiogroup" aria-label="Forma de pago" className="grid grid-cols-2 gap-2">
        {MODES.map(({ value: mode, label, icon: Icon }) => {
          const selected = value.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ ...INITIAL_PAY, mode })}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                selected ? "border-brand-700 bg-brand-50 text-brand-900 ring-1 ring-brand-700" : "border-line-strong bg-surface text-ink-soft hover:bg-sunken"
              }`}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden />
              <span className="leading-tight">{label}</span>
            </button>
          );
        })}
      </div>

      {value.mode === "mixed" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-split`} className="flex items-center gap-1.5 text-sm font-medium">
            <CreditCard className="size-4" aria-hidden />
            Con tarjeta
          </label>
          <div className="flex gap-2">
            <Input id={`${id}-split`} inputMode="decimal" placeholder="0.00" value={value.split} onChange={(e) => set({ split: e.target.value, received: "" })} />
            <Button variant="secondary" onClick={() => set({ split: String(fromCents(Math.floor(toCents(total) / 2))), received: "" })} disabled={total <= 0}>
              Mitad
            </Button>
          </div>
          <p className="tabular text-sm text-muted">
            Resto en efectivo: <span className="font-semibold text-ink">{formatMoney(resolved.cashDue)}</span>
          </p>
        </div>
      ) : null}

      {showCash ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-received`} className="flex items-center gap-1.5 text-sm font-medium">
            <Banknote className="size-4" aria-hidden />
            Recibe en efectivo
          </label>
          <Input
            id={`${id}-received`}
            inputMode="decimal"
            placeholder={formatMoney(resolved.cashDue).replace("$", "")}
            value={value.received}
            invalid={value.received !== "" && receivedValue === null}
            onChange={(e) => set({ received: e.target.value })}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={value.received === "" ? "subtle" : "secondary"} onClick={() => set({ received: "" })}>
              Exacto
            </Button>
            {quickCash(resolved.cashDue).map((amount) => (
              <Button key={amount} size="sm" variant={receivedValue === amount ? "subtle" : "secondary"} onClick={() => set({ received: String(amount) })}>
                {formatMoney(amount)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {showReference ? (
        <Input aria-label="Referencia o autorización (opcional)" placeholder="Referencia o autorización (opcional)" maxLength={80} value={value.reference} onChange={(e) => set({ reference: e.target.value })} />
      ) : null}

      {total > 0 ? (
        <div aria-live="polite" className="tabular rounded-lg bg-sunken px-3 py-2 text-sm">
          {resolved.problem ? (
            <span className="font-medium text-amber-900">{resolved.problem}</span>
          ) : resolved.change > 0 ? (
            <span className="font-semibold text-brand-800">Cambio a entregar: {formatMoney(resolved.change)}</span>
          ) : (
            <span className="font-medium text-emerald-800">Pago completo</span>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}

export type SaleDone = { id: string; folio: number; total: number; change: number; methods: PaymentMethod[] };

/** Confirmación después de cobrar: cambio en grande y comprobante. */
export function SaleDoneDialog({ sale, onClose }: { sale: SaleDone; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Cobro #${sale.folio} registrado`}
      footer={
        <>
          <LinkButton variant="secondary" href={`/ventas/cobros/${sale.id}`} icon={<Receipt className="size-4" aria-hidden />}>
            Ver comprobante
          </LinkButton>
          <Button onClick={onClose}>Nueva venta</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="success" title={`Total cobrado: ${formatMoney(sale.total)}`}>
          Pagado con {sale.methods.map((m) => PAYMENT_LABEL[m].toLowerCase()).join(" y ")}.
        </Alert>
        {sale.change > 0 ? (
          <div className="rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-5 text-center">
            <p className="text-sm font-medium text-brand-800">Entrega de cambio</p>
            <p className="tabular text-4xl font-semibold text-brand-900">{formatMoney(sale.change)}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
