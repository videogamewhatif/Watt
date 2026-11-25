import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { CATEGORIES, reportsFor } from "@/features/reports/catalog";
import { ReportIcon } from "@/features/reports/components/report-icon";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage() {
  const ctx = await getAppContext();
  const available = reportsFor(ctx);
  if (!available.length) redirect("/inicio");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Reportes"
        description="Elige un reporte. Todos se filtran por periodo, se imprimen y sus tablas se descargan en CSV para Excel u Hojas de cálculo."
      />
      {CATEGORIES.map((cat) => {
        const list = available.filter((r) => r.category === cat.key);
        if (!list.length) return null;
        return (
          <section key={cat.key} aria-labelledby={`reportes-${cat.key}`} className="space-y-3">
            <div>
              <h2 id={`reportes-${cat.key}`} className="text-lg font-semibold text-ink">
                {cat.label}
              </h2>
              <p className="text-sm text-muted">{cat.description}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <li key={r.key}>
                  <Link
                    href={`/reportes/${r.key}`}
                    className="group flex h-full gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <span className="h-fit rounded-xl bg-brand-50 p-2 text-brand-700">
                      <ReportIcon icon={r.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-semibold text-ink">
                        {r.title}
                        <ArrowRight className="size-3.5 text-brand-700 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{r.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
