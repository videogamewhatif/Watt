import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { ServiceDialog } from "@/features/services/service-dialog";
import { getAppContext } from "@/lib/session";
import { formatDuration } from "@/lib/tz";

export const metadata: Metadata = { title: "Servicios" };

export default async function ServicesPage() {
  const ctx = await getAppContext();
  const [{ data: services, error }, { data: professionals }, { data: links }] = await Promise.all([
    ctx.supabase.from("services").select("*").eq("organization_id", ctx.workspace.id).order("active", { ascending: false }).order("name"),
    ctx.supabase.from("professionals").select("id, display_name, active").eq("organization_id", ctx.workspace.id).order("display_name"),
    ctx.supabase.from("professional_services").select("professional_id, service_id").eq("organization_id", ctx.workspace.id),
  ]);
  const manage = ctx.can.manageCatalog;
  const names = Object.fromEntries((professionals ?? []).map((p) => [p.id, p.display_name]));
  const rows = (services ?? []).map((s) => ({ ...s, professional_ids: (links ?? []).filter((l) => l.service_id === s.id).map((l) => l.professional_id) }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Servicios"
        description="Cada servicio tiene una duración y se asigna a uno o varios profesionales."
        actions={manage ? <ServiceDialog organizationId={ctx.workspace.id} professionals={professionals ?? []} /> : null}
      />
      {error ? <p className="text-sm text-red-700">No pudimos cargar los servicios. Recarga la página.</p> : null}
      {rows.length === 0 && !error ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<ClipboardList className="size-6" aria-hidden />} title="Aún no hay servicios">
            {manage ? "Crea servicios como «Consulta general (30 min)» o «Limpieza dental (45 min)»." : "La administración aún no ha creado servicios."}
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${s.active ? "" : "text-muted"}`}>{s.name}</span>
                  <span className="tabular rounded-full bg-sunken px-2 py-0.5 text-xs">{formatDuration(s.duration_minutes)}</span>
                  {!s.active ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300">Inactivo</span> : null}
                </p>
                {s.description ? <p className="text-sm text-muted">{s.description}</p> : null}
                <p className="mt-0.5 text-xs text-muted">
                  {s.professional_ids.length ? s.professional_ids.map((id) => names[id]).filter(Boolean).join(", ") : "Sin profesionales asignados"}
                </p>
              </div>
              {manage ? <ServiceDialog organizationId={ctx.workspace.id} service={s} professionals={professionals ?? []} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
