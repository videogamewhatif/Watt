import { Check, Minus } from "lucide-react";
import { FEATURE_GROUPS, FEATURES } from "../catalog";
import { comparisonCell } from "../presenter";
import type { PlanEntitlementRow, PlanRow } from "../types";

/**
 * Tabla comparativa completa. En pantallas angostas se desplaza horizontalmente
 * dentro de su propio contenedor (con foco por teclado) y la primera columna
 * queda fija; la página no se desplaza de lado.
 */
export function PricingComparison({ plans, entitlements, highlightCode }: { plans: PlanRow[]; entitlements: PlanEntitlementRow[]; highlightCode?: string | null }) {
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="relative overflow-x-auto rounded-2xl" tabIndex={0} role="region" aria-labelledby="comparativa-titulo">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption id="comparativa-titulo" className="sr-only">
            Comparación de funciones por plan
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-4 text-left font-semibold text-ink">
                Función
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className={`px-4 py-4 text-center font-semibold ${p.code === highlightCode ? "bg-brand-50 text-brand-800" : "text-ink"}`}>
                  {p.name}
                  {p.badge ? <span className="mt-0.5 block text-[11px] font-medium text-brand-700">{p.badge}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          {FEATURE_GROUPS.map((group) => {
            const rows = FEATURES.filter((f) => f.group === group.key);
            return (
              <tbody key={group.key}>
                <tr className="bg-sunken/60">
                  <th scope="colgroup" colSpan={plans.length + 1} className="sticky left-0 px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                    {group.label}
                  </th>
                </tr>
                {rows.map((f) => (
                  <tr key={f.code} className="border-b border-line last:border-0">
                    <th scope="row" className="sticky left-0 z-10 w-36 bg-surface px-4 py-3 text-left font-normal text-ink-soft sm:w-auto">
                      <span className="font-medium text-ink">{f.label}</span>
                      {"soon" in f && f.soon ? <span className="ml-2 rounded-full bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted">Próximamente</span> : null}
                      {"hint" in f && f.hint ? <span className="mt-0.5 hidden text-xs text-muted sm:block">{f.hint}</span> : null}
                    </th>
                    {plans.map((p) => {
                      const cell = comparisonCell(p.id, f.code, entitlements);
                      return (
                        <td key={p.id} className={`px-4 py-3 text-center ${p.code === highlightCode ? "bg-brand-50/60" : ""}`}>
                          {cell.text ? (
                            <span className="tabular font-semibold text-ink">{cell.text}</span>
                          ) : cell.included ? (
                            <>
                              <Check className="mx-auto size-5 text-brand-600" aria-hidden />
                              <span className="sr-only">Incluido</span>
                            </>
                          ) : (
                            <>
                              <Minus className="mx-auto size-4 text-line-strong" aria-hidden />
                              <span className="sr-only">No incluido</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
