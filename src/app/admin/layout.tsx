import { LogOut, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DemoBanner } from "@/components/shell/demo-banner";
import { Wordmark } from "@/components/ui/layout";
import { ToastProvider } from "@/components/ui/toast";
import { signOut } from "@/features/auth/actions";
import { getPlatformRole } from "@/features/billing/server";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { getAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Plataforma", template: "%s · Plataforma Wattalis" } };

/**
 * Área del equipo Wattalis. Exige un rol de PLATAFORMA (platform_admins), nunca
 * el rol Administración de una clínica. A quien no lo tiene se le responde 404.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { user, demo } = await getAuthUser();
  if (!user) redirect("/iniciar-sesion?next=/admin/suscripciones");
  const role = await getPlatformRole();
  if (!role) notFound();
  return (
    <ToastProvider>
      <div className="min-h-dvh">
        {demo ? <DemoBanner current={demo} personas={DEMO_PERSONAS} /> : null}
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <Wordmark className="text-xl" />
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-900 px-2.5 py-1 text-xs font-semibold text-white">
              <ShieldCheck className="size-3.5" aria-hidden />
              Panel de la plataforma
            </span>
            <span className="ml-auto truncate text-sm text-muted">{user.email}</span>
            <form action={signOut}>
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken">
                <LogOut className="size-4" aria-hidden />
                Salir
              </button>
            </form>
          </div>
        </header>
        <main id="contenido" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
