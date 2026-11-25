import type { NextRequest } from "next/server";
import { getPracticeContext } from "@/features/practice/queries";
import { canViewReport, findReport } from "@/features/reports/catalog";
import { csvFilename, tableToCsv } from "@/features/reports/format";
import { effectiveFilters, parseReportFilters } from "@/features/reports/params";
import { loadReport } from "@/features/reports/queries";
import { getAppContext } from "@/lib/session";
import { todayIn } from "@/lib/tz";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Descarga una tabla de un reporte en CSV, con los mismos filtros y permisos que la página. */
export async function GET(request: NextRequest, { params }: RouteContext<"/reportes/[reporte]/csv">) {
  const { reporte } = await params;
  const def = findReport(reporte);
  if (!def) return text("Reporte no encontrado.", 404);
  const ctx = await getAppContext();
  if (!canViewReport(def, ctx)) return text("Reporte no encontrado.", 404);

  const search = request.nextUrl.searchParams;
  const { areas } = await getPracticeContext();
  const filters = effectiveFilters(
    parseReportFilters(Object.fromEntries(search), todayIn(ctx.workspace.timezone)),
    def,
    areas.map((a) => a.key),
  );
  const report = await loadReport(ctx, def.key, filters);
  const table = report?.tables.find((t) => t.id === search.get("tabla"));
  if (!report || !table) return text("Tabla no encontrada.", 404);
  // Un archivo incompleto se confundiría con datos reales: mejor un error claro.
  if (report.error) return text("No pudimos generar el archivo. Intenta de nuevo.", 503);

  return new Response(`﻿${tableToCsv(table)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(def.key, table.id, filters.from, filters.to)}"`,
      "Cache-Control": "no-store",
    },
  });
}
