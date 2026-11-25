import { Check } from "lucide-react";

export const CHECKOUT_STEPS = ["Plan", "Cuenta", "Organización", "Resumen", "Pago", "Confirmación"] as const;

/** Indicador de etapas de la contratación (1–6). */
export function SubscriptionCheckoutStepper({ current }: { current: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const pct = ((current - 1) / (CHECKOUT_STEPS.length - 1)) * 100;
  return (
    <nav aria-label="Etapas de la contratación" className="mb-8">
      {/* Teléfono: etapa actual y barra de avance. */}
      <div className="sm:hidden">
        <p className="text-sm font-medium text-ink">
          Paso {current} de {CHECKOUT_STEPS.length} · <span className="text-brand-700">{CHECKOUT_STEPS[current - 1]}</span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${Math.max(pct, 6)}%` }} />
        </div>
      </div>
      <ol className="hidden items-center sm:flex">
        {CHECKOUT_STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="flex flex-1 items-center last:flex-none" aria-current={active ? "step" : undefined}>
              <span className="flex items-center gap-2">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300 ${
                    done ? "bg-brand-700 text-white" : active ? "bg-brand-700 text-white ring-4 ring-brand-100" : "border border-line-strong bg-surface text-muted"
                  }`}
                >
                  {done ? <Check className="size-4" aria-hidden /> : n}
                </span>
                <span className={`text-sm whitespace-nowrap ${active ? "font-semibold text-ink" : done ? "text-ink-soft" : "text-muted"}`}>
                  {label}
                  {done ? <span className="sr-only"> (completado)</span> : null}
                </span>
              </span>
              {n < CHECKOUT_STEPS.length ? <span aria-hidden className={`mx-3 h-px flex-1 transition-colors duration-300 ${done ? "bg-brand-600" : "bg-line-strong"}`} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
