import { ChevronRight, Contact, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { NewContactButton } from "@/features/patients/components";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Pacientes" };

export default async function PatientsPage({ searchParams }: PageProps<"/pacientes">) {
  const ctx = await getAppContext();
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 80);
  // RLS limita la búsqueda: el rol Profesional solo encuentra a sus pacientes.
  const { data: contacts, error } = await ctx.supabase.rpc("search_contacts", { p_organization_id: ctx.workspace.id, p_query: q, p_limit: 50 });
  const title = ctx.can.allAppointments ? "Pacientes o contactos" : "Mis pacientes";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={title}
        description={
          ctx.can.allAppointments
            ? "Directorio administrativo del espacio. Sin información clínica."
            : "Pacientes vinculados a tus citas y los que registraste."
        }
        actions={<NewContactButton organizationId={ctx.workspace.id} />}
      />
      <form role="search" className="mb-4 flex gap-2" action="/pacientes">
        <label htmlFor="buscar" className="sr-only">
          Buscar por nombre, teléfono o correo
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="buscar"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre, teléfono o correo"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-sm"
          />
        </div>
        <button type="submit" className={buttonClass("secondary")}>
          Buscar
        </button>
      </form>
      {error ? <p className="text-sm text-red-700">No pudimos buscar. Intenta de nuevo.</p> : null}
      {contacts && contacts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<Contact className="size-6" aria-hidden />} title={q ? "Sin resultados" : "Aún no hay pacientes"}>
            {q ? `No encontramos coincidencias para «${q}».` : "Registra pacientes aquí o directamente al agendar una cita."}
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {(contacts ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/pacientes/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.full_name}</span>
                  <span className="block truncate text-sm text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                </span>
                <ChevronRight className="size-4 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {contacts && contacts.length === 50 ? <p className="mt-3 text-sm text-muted">Se muestran los primeros 50. Afina la búsqueda para ver otros.</p> : null}
    </div>
  );
}
