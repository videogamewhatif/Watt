import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { PrintButton } from "@/features/cash/components/print-button";
import { getPracticeContext } from "@/features/practice/queries";
import { canViewReport, findReport } from "@/features/reports/catalog";
import { FilterBar } from "@/features/reports/components/filter-bar";
import { ReportIcon } from "@/features/reports/components/report-icon";
import { ReportView } from "@/features/reports/components/report-view";
import { csvHref, effectiveFilters, parseReportFilters, periodLabel } from "@/features/reports/params";
import { loadReport, reportProfessionalOptions } from "@/features/reports/queries";
import { getAppContext } from "@/lib/session";
import { formatInstant, todayIn } from "@/lib/tz";

export async function generateMetadata({ params }: PageProps<"/reportes/[reporte]">): Promise<Metadata> {
  const { reporte } = await params;
  return { title: findReport(reporte)?.title ?? "Reportes" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/reportes/[reporte]">) {
  const { reporte } = await params;
  const def = findReport(reporte);
  if (!def) notFound();
  const ctx = await getAppContext();
  if (!canViewReport(def, ctx)) notFound();

  const tz = ctx.workspace.timezone;
  const [{ areas }, professionals] = await Promise.all([getPracticeContext(), def.filters.professional ? reportProfessionalOptions(ctx) : Promise.resolve([])]);
  const filters = effectiveFilters(
    parseReportFilters(await searchParams, todayIn(tz)),
    def,
    areas.map((a) => a.key),
  );
  const report = await loadReport(ctx, def.key, filters);
  if (!report) notFound();

  const scope = [
    filters.area ? areas.find((a) => a.key === filters.area)?.label : null,
    filters.professionalId ? professionals.find((p) => p.id === filters.professionalId)?.name : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/reportes" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline print:hidden">
          <ArrowLeft className="size-4" aria-hidden />
          Reportes
        </Link>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <span className="rounded-lg bg-brand-50 p-1.5 text-brand-700 print:hidden">
                <ReportIcon icon={def.icon} className="size-5" />
              </span>
              {def.title}
            </span>
          }
          description={
            <>
              <span className="font-medium text-ink-soft">{periodLabel(filters.from, filters.to)}</span>
              {scope.length ? ` · ${scope.join(" · ")}` : ""}
              <span className="hidden print:inline">
                {" "}
                · {ctx.workspace.name} · Generado el {formatInstant(new Date(), tz)}
              </span>
            </>
          }
          actions={
            <span className="print:hidden">
              <PrintButton />
            </span>
          }
        />
      </div>

      <FilterBar
        reportKey={def.key}
        filters={filters}
        areas={areas}
        professionals={professionals}
        showArea={def.filters.area && areas.length > 1}
        showProfessional={def.filters.professional}
      />

      <ReportView report={report} csvHref={(tableId) => csvHref(def.key, tableId, filters)} />
    </div>
  );
}
