/** Uso contra el límite del plan (texto + barra; el valor nunca depende solo del color). */
export function PlanUsageIndicator({ label, used, limit, unit }: { label: string; used: number; limit: number | null; unit: string }) {
  const pct = limit === null || limit === 0 ? (limit === 0 ? 100 : 0) : Math.min((used / limit) * 100, 100);
  const over = limit !== null && used > limit;
  const full = limit !== null && used >= limit;
  const tone = over ? "bg-red-600" : full ? "bg-amber-500" : "bg-brand-600";
  const available = limit === null ? null : Math.max(limit - used, 0);
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="tabular text-sm text-ink-soft">
          <span className="text-lg font-semibold text-ink">{used}</span>
          {limit === null ? " · sin límite fijo" : ` de ${limit}`}
        </p>
      </div>
      {limit !== null ? (
        <div
          role="meter"
          aria-label={`${label}: ${used} de ${limit}`}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="mt-3 h-2 overflow-hidden rounded-full bg-sunken"
        >
          <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <p className={`mt-2 text-xs ${over ? "font-medium text-red-700" : full ? "font-medium text-amber-800" : "text-muted"}`}>
        {limit === null
          ? `Tu plan no limita los ${unit}.`
          : over
            ? `Superas el límite por ${used - limit}. No se elimina nada; no podrás agregar más ${unit} hasta quedar dentro del límite o mejorar tu plan.`
            : full
              ? `Llegaste al límite. Mejora tu plan para agregar más ${unit}.`
              : `${available} ${unit} disponibles.`}
      </p>
    </div>
  );
}
