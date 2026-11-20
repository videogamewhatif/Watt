import { ChevronRight, Plus, Stethoscope, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Profesionales" };

export default async function ProfessionalsPage() {
  const ctx = await getAppContext();
  const [{ data: professionals, error }, { data: types }, { data: links }, { data: rules }] = await Promise.all([
    ctx.supabase.from("professionals").select("*").eq("organization_id", ctx.workspace.id).order("active", { ascending: false }).order("display_name"),
    ctx.supabase.from("professional_types").select("code, label"),
    ctx.supabase.from("professional_services").select("professional_id").eq("organization_id", ctx.workspace.id),
    ctx.supabase.from("availability_rules").select("professional_id").eq("organization_id", ctx.workspace.id),
  ]);
  const typeLabel = Object.fromEntries((types ?? []).map((t) => [t.code, t.label]));
  const count = (rows: { professional_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.professional_id === id).length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Profesionales"
        description="Personas cuya agenda se administra. Pueden existir sin cuenta de acceso."
        actions={
          ctx.can.manageCatalog ? (
            <LinkButton href="/profesionales/nuevo" icon={<Plus className="size-4" aria-hidden />}>
              Nuevo profesional
            </LinkButton>
          ) : null
        }
      />
      {error ? <p className="text-sm text-red-700">No pudimos cargar los profesionales. Recarga la página.</p> : null}
      {professionals && professionals.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState
            icon={<Stethoscope className="size-6" aria-hidden />}
            title="Aún no hay profesionales"
            action={ctx.can.manageCatalog ? <LinkButton href="/profesionales/nuevo">Registrar al primer profesional</LinkButton> : null}
          >
            Registra médicos, dentistas, nutriólogos, veterinarios u otros profesionales para administrar su agenda.
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {(professionals ?? []).map((p) => {
            const services = count(links, p.id);
            const hasSchedule = count(rules, p.id) > 0;
            return (
              <li key={p.id}>
                <Link href={`/profesionales/${p.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-sunken">
                  <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`font-semibold ${p.active ? "" : "text-muted"}`}>{p.display_name}</span>
                      {!p.active ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300">Inactivo</span> : null}
                      {p.user_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
                          <UserRound className="size-3" aria-hidden /> Con cuenta
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {typeLabel[p.professional_type] ?? p.professional_type}
                      {p.specialty ? ` · ${p.specialty}` : ""}
                    </span>
                  </span>
                  <span className="hidden text-right text-xs text-muted sm:block">
                    {services === 1 ? "1 servicio" : `${services} servicios`}
                    <span className={`block ${hasSchedule ? "" : "font-medium text-amber-800"}`}>{hasSchedule ? "Con horario" : "Sin horario"}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
