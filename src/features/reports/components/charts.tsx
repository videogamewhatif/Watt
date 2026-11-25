// Gráficas sin bibliotecas ni JavaScript en el navegador: HTML y CSS que se
// dibujan en el servidor, se imprimen bien y muestran el detalle al pasar el
// cursor. Cada gráfica tiene su tabla en el mismo reporte (los valores nunca
// dependen solo del color ni del cursor).
import type { ReactNode } from "react";
import type { Chart, ChartPoint, Format } from "../model";
import { formatCell } from "../format";

/** Color de la serie única: el azul petróleo de la marca. */
const SERIES = "var(--color-brand-600)";

/**
 * Estados de cita en la barra segmentada. Paleta validada (scripts de dataviz):
 * pares contiguos distinguibles con daltonismo y contraste ≥ 3:1. «Cancelada» es
 * gris a propósito (no cuenta) y además lleva textura.
 */
const SEGMENT_COLOR: Record<string, string> = {
  attended: "#047857",
  confirmed: "#0284c7",
  pending: "#d97706",
  no_show: "#be123c",
  cancelled: "#8b7f74",
};
const SEGMENT_TEXTURE = new Set(["cancelled"]);

/** Rampa secuencial de un solo tono (claro → oscuro) para el mapa de calor. */
const HEAT_STEPS = ["var(--color-brand-100)", "var(--color-brand-200)", "var(--color-brand-300)", "var(--color-brand-500)", "var(--color-brand-700)"];

const compact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

/** Marcas del eje: 0, la mitad y un máximo "redondo" (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * exp >= value) ?? 10;
  return step * exp;
}

function tick(value: number, format: Format): string {
  if (format === "money") return value >= 10_000 ? `$${compact.format(value)}` : formatCell(Math.round(value), "money").replace(/\.00$/, "");
  if (format === "pct") return formatCell(value, "pct");
  return value >= 10_000 ? compact.format(value) : formatCell(value, "int");
}

/** Detalle al pasar el cursor: primero el valor, luego la etiqueta. */
function Tooltip({ point, format, align = "center" }: { point: ChartPoint; format: Format; align?: "center" | "start" }) {
  return (
    <span
      className={`pointer-events-none absolute bottom-full z-10 mb-1.5 hidden w-max max-w-48 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left shadow-md group-hover:block print:hidden ${
        align === "center" ? "left-1/2 -translate-x-1/2" : "left-0"
      }`}
    >
      <span className="block text-sm font-semibold text-ink">{formatCell(point.value, format)}</span>
      <span className="block text-xs text-muted">
        {point.label}
        {point.hint ? ` · ${point.hint}` : null}
      </span>
    </span>
  );
}

function Frame({ chart, summary, children }: { chart: Chart; summary: string; children: ReactNode }) {
  return (
    <figure className="min-w-0 rounded-2xl border border-line bg-surface px-5 py-4 break-inside-avoid">
      <figcaption className="mb-4">
        <p className="text-base font-semibold text-ink">{chart.title}</p>
        {chart.description ? <p className="mt-0.5 text-sm text-muted">{chart.description}</p> : null}
      </figcaption>
      <div role="img" aria-label={`${chart.title}. ${summary}`}>
        <div aria-hidden>{children}</div>
      </div>
    </figure>
  );
}

function summarize(points: ChartPoint[], format: Format): string {
  if (!points.length) return "Sin datos.";
  const top = points.reduce((a, b) => (b.value > a.value ? b : a));
  return `Valor más alto: ${top.label}, ${formatCell(top.value, format)}. El detalle está en la tabla del reporte.`;
}

/** Una serie en el tiempo: columnas que crecen desde la línea base. */
function ColumnChart({ chart }: { chart: Extract<Chart, { kind: "columns" }> }) {
  const { points, format } = chart;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const peak = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? 0) ? i : best), 0);
  const every = Math.max(1, Math.ceil(points.length / 8));
  const empty = points.every((p) => p.value === 0);

  return (
    <Frame chart={chart} summary={summarize(points, format)}>
      {empty ? (
        <p className="py-10 text-center text-sm text-muted">Sin datos en el periodo.</p>
      ) : (
        <div className="flex gap-2">
          <div className="tabular flex h-44 w-14 shrink-0 flex-col justify-between text-right text-[11px] text-muted">
            <span className="-translate-y-1/2">{tick(max, format)}</span>
            <span>{tick(max / 2, format)}</span>
            <span className="translate-y-1/2">{tick(0, format)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-44 border-b border-line-strong">
              {/* Rejilla recesiva: líneas finas y sólidas. */}
              <div className="absolute inset-x-0 top-0 border-t border-line" />
              <div className="absolute inset-x-0 top-1/2 border-t border-line" />
              <div className="absolute inset-0 flex items-end gap-0.5">
                {points.map((p, i) => (
                  <div key={`${p.label}-${i}`} className="group relative flex h-full flex-1 items-end justify-center hover:bg-sunken/70">
                    <Tooltip point={p} format={format} />
                    {i === peak && p.value > 0 ? (
                      <span className="tabular absolute z-0 mb-1 text-[11px] font-medium text-ink-soft" style={{ bottom: `${(p.value / max) * 100}%` }}>
                        {tick(p.value, format)}
                      </span>
                    ) : null}
                    <div
                      className="w-full max-w-6 rounded-t-[4px] group-hover:opacity-80"
                      style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0, background: SERIES }}
                    />
                  </div>
                ))}
              </div>
            </div>
            {/*
              Etiquetas del eje sin salirse de la gráfica: la primera se alinea a la
              izquierda y la última a la derecha; las intermedias solo caben en
              pantallas anchas.
            */}
            <div className="relative mt-1.5 h-4 text-[11px] text-muted">
              {points.map((p, i) => {
                const first = i === 0;
                const last = i === points.length - 1 && i > 0;
                const middle = !first && !last && i % every === 0 && points.length - 1 - i >= every * 0.75;
                if (!first && !last && !middle) return null;
                const style = first ? { left: 0 } : last ? { right: 0 } : { left: `${((i + 0.5) / points.length) * 100}%`, transform: "translateX(-50%)" };
                return (
                  <span key={`${p.label}-${i}`} className={`absolute top-0 whitespace-nowrap ${middle ? "hidden sm:block" : ""}`} style={style}>
                    {p.label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
}

/** Comparación entre categorías: barras horizontales con el valor en la punta. */
function BarChart({ chart }: { chart: Extract<Chart, { kind: "bars" }> }) {
  const { points, format } = chart;
  const max = chart.max ?? Math.max(0, ...points.map((p) => p.value));
  return (
    <Frame chart={chart} summary={summarize(points, format)}>
      {max <= 0 ? (
        <p className="py-10 text-center text-sm text-muted">Sin datos en el periodo.</p>
      ) : (
        <ul className="space-y-2.5">
          {points.map((p, i) => (
            <li key={`${p.label}-${i}`} className="group relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
              <Tooltip point={p} format={format} align="start" />
              <span className="truncate text-sm text-ink-soft">{p.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-4 shrink-0 rounded-r-[4px] group-hover:opacity-80"
                  style={{ width: `calc(${(Math.max(0, p.value) / max) * 100}% - 6.5rem)`, minWidth: p.value > 0 ? 2 : 0, background: SERIES }}
                />
                <span className="tabular text-sm font-medium whitespace-nowrap text-ink">{formatCell(p.value, format)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/** Un total repartido en partes: barra alta segmentada, leyenda en el mismo orden. */
function SegmentChart({ chart }: { chart: Extract<Chart, { kind: "segments" }> }) {
  const total = chart.parts.reduce((n, p) => n + p.value, 0);
  const share = (v: number) => (total ? v / total : 0);
  const summary = total
    ? chart.parts
        .filter((p) => p.value)
        .map((p) => `${p.label}: ${p.value}`)
        .join(", ")
    : "Sin datos.";
  return (
    <Frame chart={chart} summary={summary}>
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Sin datos en el periodo.</p>
      ) : (
        <>
          <div className="flex h-7 gap-0.5">
            {chart.parts
              .filter((p) => p.value > 0)
              .map((p) => {
                const s = share(p.value);
                const color = SEGMENT_COLOR[p.key] ?? SERIES;
                return (
                  <div key={p.key} className="group relative h-full" style={{ width: `${s * 100}%` }}>
                    <Tooltip point={{ label: p.label, value: p.value, hint: formatCell(s, "pct") }} format="int" />
                    <div
                      className="flex h-full items-center overflow-visible rounded-[4px] px-1.5 group-hover:opacity-85"
                      style={{
                        background: color,
                        backgroundImage: SEGMENT_TEXTURE.has(p.key) ? "repeating-linear-gradient(45deg, transparent 0 5px, rgb(255 255 255 / 0.28) 5px 7px)" : undefined,
                      }}
                    >
                      {/* La proporción solo se escribe dentro si cabe con holgura. */}
                      {s >= 0.12 ? <span className="tabular text-xs font-semibold text-white">{formatCell(s, "pct")}</span> : null}
                    </div>
                  </div>
                );
              })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {chart.parts.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-[3px]"
                  style={{
                    background: SEGMENT_COLOR[p.key] ?? SERIES,
                    backgroundImage: SEGMENT_TEXTURE.has(p.key) ? "repeating-linear-gradient(45deg, transparent 0 3px, rgb(255 255 255 / 0.35) 3px 4px)" : undefined,
                  }}
                />
                <span className="text-ink-soft">{p.label}</span>
                <span className="tabular font-medium text-ink">{p.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  );
}

/** Intensidad por día y hora con una rampa de un solo tono. */
function Heatmap({ chart }: { chart: Extract<Chart, { kind: "heatmap" }> }) {
  const max = Math.max(0, ...chart.values.flat());
  const step = (v: number) => (v <= 0 || max <= 0 ? -1 : Math.min(HEAT_STEPS.length - 1, Math.ceil((v / max) * HEAT_STEPS.length) - 1));
  let peak = { row: 0, col: 0, value: 0 };
  chart.values.forEach((r, ri) => r.forEach((v, ci) => (v > peak.value ? (peak = { row: ri, col: ci, value: v }) : null)));
  const summary = peak.value ? `Mayor demanda: ${chart.rowLabels[peak.row]} a las ${chart.colLabels[peak.col]}, ${peak.value} citas.` : "Sin datos.";
  return (
    <Frame chart={chart} summary={summary}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className="w-10" />
              {chart.colLabels.map((c) => (
                <th key={c} className="tabular px-0.5 pb-1 text-center font-normal whitespace-nowrap text-muted">
                  {c.replace(":00", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rowLabels.map((label, ri) => (
              <tr key={label}>
                <th className="pr-2 text-left font-medium text-ink-soft">{label}</th>
                {chart.values[ri].map((v, ci) => {
                  const s = step(v);
                  return (
                    <td key={ci} className="group relative h-7 min-w-7 rounded-[4px] text-center" style={{ background: s < 0 ? "var(--color-sunken)" : HEAT_STEPS[s] }}>
                      <Tooltip point={{ label: `${label} ${chart.colLabels[ci]}`, value: v }} format="int" />
                      {v > 0 ? <span className={`tabular font-medium ${s >= 3 ? "text-white" : "text-ink"}`}>{v}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted">
        <span>Menos</span>
        {HEAT_STEPS.map((c) => (
          <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />
        ))}
        <span>Más</span>
      </div>
    </Frame>
  );
}

export function ReportChart({ chart }: { chart: Chart }) {
  switch (chart.kind) {
    case "columns":
      return <ColumnChart chart={chart} />;
    case "bars":
      return <BarChart chart={chart} />;
    case "segments":
      return <SegmentChart chart={chart} />;
    case "heatmap":
      return <Heatmap chart={chart} />;
  }
}
