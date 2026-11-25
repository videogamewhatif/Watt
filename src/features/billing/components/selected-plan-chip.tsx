import Link from "next/link";
import { formatCents, INTERVAL_LABEL, quote } from "../pricing";
import type { BillingInterval, BillingSettingsRow, PlanRow } from "../types";

/** Recordatorio del plan elegido durante la contratación, con enlace para cambiarlo. */
export function SelectedPlanChip({ plan, interval, settings, changeHref }: { plan: PlanRow; interval: BillingInterval; settings: BillingSettingsRow; changeHref: string }) {
  const q = quote(plan, interval, settings);
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
      <p className="text-ink-soft">
        <span className="font-semibold text-ink">Plan {plan.name}</span> · {INTERVAL_LABEL[interval]}
        {q ? (
          <>
            {" "}
            · <span className="tabular font-medium text-ink">{formatCents(q.periodPriceCents)} MXN</span>/{interval === "year" ? "año" : "mes"}
          </>
        ) : null}
      </p>
      <Link href={changeHref} className="font-medium text-brand-700 hover:underline">
        Cambiar plan
      </Link>
    </div>
  );
}
