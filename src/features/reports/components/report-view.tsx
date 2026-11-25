import { Download, Info } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/layout";
import type { Kpi, LoadedReport, ReportTable } from "../model";
import { formatCell, isNumeric } from "../format";
import { ReportChart } from "./charts";

function KpiTile({ kpi }: { kpi: Kpi }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 break-inside-avoid ${kpi.strong ? "border-brand-700 bg-brand-50" : "border-line bg-surface"}`}>
      <p className="text-xs font-medium text-muted">{kpi.label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${kpi.strong ? "text-brand-900" : "text-ink"}`}>{formatCell(kpi.value, kpi.format)}</p>
      {kpi.hint ? <p className="mt-0.5 text-xs text-muted">{kpi.hint}</p> : null}
    </div>
  );
}

function DataTable({ table, csvHref }: { table: ReportTable; csvHref: string }) {
  const shown = table.preview ? table.rows.slice(0, table.preview) : table.rows;
  const hidden = table.rows.length - shown.length;
  const cellClass = (i: number) => {
    const col = table.columns[i];
    return [
      "px-3 py-2 first:pl-5 last:pr-5",
      // La primera columna (nombre, fecha, concepto) no se parte en varias líneas angostas.
      i === 0 ? "min-w-40" : "",
      isNumeric(col.format) ? "tabular text-right whitespace-nowrap" : "",
      col.format === "date" || col.format === "datetime" || col.format === "month" ? "whitespace-nowrap" : "",
      col.secondary ? "hidden md:table-cell print:table-cell" : "",
    ].join(" ");
  };

  return (
    <Card className="break-inside-avoid">
      <CardHeader
        title={table.title}
        description={table.description}
        actions={
          table.rows.length ? (
            <a href={csvHref} download className={buttonClass("secondary", "sm", "print:hidden")}>
              <Download className="size-4" aria-hidden />
              CSV
              <span className="sr-only"> de «{table.title}»</span>
            </a>
          ) : null
        }
      />
      {table.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{table.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                {table.columns.map((c, i) => (
                  <th key={c.key} scope="col" className={`${cellClass(i)} font-medium ${isNumeric(c.format) ? "" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((row, ri) => (
                <tr key={ri} className={`${row.muted ? "text-muted" : "text-ink"} hover:bg-sunken/60`}>
                  {table.columns.map((c, i) => {
                    const text = formatCell(row.values[c.key] ?? null, c.format);
                    return i === 0 ? (
                      <th key={c.key} scope="row" className={`${cellClass(i)} text-left font-medium`}>
                        {row.href ? (
                          <Link href={row.href} className="underline-offset-2 hover:underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </th>
                    ) : (
                      <td key={c.key} className={cellClass(i)}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {table.total ? (
              <tfoot>
                <tr className="border-t border-line-strong bg-sunken/50 font-semibold">
                  {table.columns.map((c, i) => {
                    const value = table.total?.[c.key];
                    return i === 0 ? (
                      <th key={c.key} scope="row" className={`${cellClass(i)} text-left`}>
                        {value === undefined ? "" : formatCell(value, c.format)}
                      </th>
                    ) : (
                      <td key={c.key} className={cellClass(i)}>
                        {value === undefined ? "" : formatCell(value, c.format)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      {hidden > 0 ? (
        <p className="border-t border-line px-5 py-2 text-xs text-muted">
          Se muestran {shown.length} de {table.rows.length}. Descarga el CSV para verlos todos.
        </p>
      ) : null}
    </Card>
  );
}

/** Dibuja cualquier reporte: indicadores, gráficas, tablas y notas. */
export function ReportView({ report, csvHref }: { report: LoadedReport; csvHref: (tableId: string) => string }) {
  const wide = report.charts.filter((c) => c.kind === "columns" || c.kind === "heatmap");
  const narrow = report.charts.filter((c) => c.kind === "bars" || c.kind === "segments");
  return (
    <div className="space-y-6">
      {report.error ? (
        <Alert tone="error" title="El reporte puede estar incompleto">
          No pudimos leer parte de la información. Recarga la página para intentarlo de nuevo.
        </Alert>
      ) : null}
      {report.truncated ? (
        <Alert tone="warning" title="Hay demasiados registros en este periodo">
          Elige un periodo más corto para ver todos los datos.
        </Alert>
      ) : null}

      {report.kpis.length ? (
        <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]">
          {report.kpis.map((k) => (
            <KpiTile key={k.label} kpi={k} />
          ))}
        </section>
      ) : null}

      {narrow.length ? (
        <div className={`grid gap-6 ${narrow.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {narrow.map((c) => (
            <ReportChart key={c.id} chart={c} />
          ))}
        </div>
      ) : null}
      {wide.map((c) => (
        <ReportChart key={c.id} chart={c} />
      ))}

      {report.tables.map((t) => (
        <DataTable key={t.id} table={t} csvHref={csvHref(t.id)} />
      ))}

      {report.notes.length ? (
        <ul className="space-y-1.5 text-xs text-muted">
          {report.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
