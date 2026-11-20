import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui/layout";
import { signOut } from "@/features/auth/actions";
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form";
import { getAuthUser, getWorkspaces } from "@/lib/session";

export const metadata: Metadata = { title: "Bienvenida" };

export default async function WelcomePage({ searchParams }: PageProps<"/bienvenida">) {
  const { supabase, user } = await getAuthUser();
  if (!user) redirect("/iniciar-sesion");
  const { workspaces } = await getWorkspaces();
  const creatingAnother = (await searchParams).nuevo === "1";
  if (workspaces.length > 0 && !creatingAnother) redirect("/inicio");

  const [{ data: types }, { data: profile }] = await Promise.all([
    supabase.from("professional_types").select("*").eq("active", true).order("sort_order"),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Wordmark className="text-2xl" />
        {workspaces.length > 0 ? (
          <Link href="/inicio" className="text-sm font-medium text-brand-700 hover:underline">
            Volver a mi espacio
          </Link>
        ) : (
          <form action={signOut}>
            <button type="submit" className="text-sm font-medium text-muted hover:text-ink hover:underline">
              Cerrar sesión
            </button>
          </form>
        )}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{creatingAnother ? "Crear otro espacio de trabajo" : "Te damos la bienvenida a Wattalis"}</h1>
      <p className="mt-2 text-sm text-muted">
        Un espacio de trabajo agrupa la agenda, los profesionales y los pacientes de tu hospital, clínica o consultorio. Su información es
        independiente de cualquier otro espacio.
      </p>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-7" aria-labelledby="crear">
        <h2 id="crear" className="mb-5 text-lg font-semibold">
          Crear un espacio
        </h2>
        <CreateWorkspaceForm types={types ?? []} defaultName={profile?.full_name ?? ""} />
      </section>

      {workspaces.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-dashed border-line-strong p-5 text-sm" aria-labelledby="invitacion">
          <h2 id="invitacion" className="font-semibold">
            ¿Te invitaron a un espacio existente?
          </h2>
          <p className="mt-1 text-muted">
            Abre el enlace de invitación que te compartió la administración (por ejemplo, <span className="font-mono">…/invitacion/…</span>) con
            esta misma cuenta. La invitación solo funciona con el correo al que fue enviada: <strong>{user.email}</strong>.
          </p>
        </section>
      ) : null}
    </main>
  );
}
