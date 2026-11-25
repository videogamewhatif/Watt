"use client";

import { useId } from "react";
import type { BillingInterval } from "../types";

/**
 * Selector Mensual / Anual. Grupo de radios nativo: se recorre con flechas y se
 * anuncia como un solo control.
 */
export function BillingIntervalToggle({
  value,
  onChange,
  discountBps,
  className = "",
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
  discountBps: number;
  className?: string;
}) {
  const name = useId();
  const options: { value: BillingInterval; label: string }[] = [
    { value: "month", label: "Mensual" },
    { value: "year", label: "Anual" },
  ];
  return (
    <fieldset className={`inline-flex flex-col items-center gap-2 ${className}`}>
      <legend className="sr-only">Periodicidad de facturación</legend>
      <div className="relative inline-flex rounded-full border border-line bg-surface p-1 shadow-sm">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={`relative cursor-pointer rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-200 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-focus)] ${
                checked ? "bg-brand-700 text-white shadow" : "text-ink-soft hover:text-ink"
              }`}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
              {o.value === "year" && discountBps > 0 ? (
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${checked ? "bg-white/20 text-white" : "bg-amber-100 text-amber-900"}`}>
                  −{discountBps / 100} %
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {value === "year"
          ? `Un solo cargo al año con ${discountBps / 100} % de descuento frente a 12 pagos mensuales.`
          : "Cargo cada mes. Puedes cambiar a anual en cualquier momento."}
      </p>
    </fieldset>
  );
}
