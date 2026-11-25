import Link from "next/link";
import { DemoBanner } from "@/components/shell/demo-banner";
import { buttonClass } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/layout";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { getAuthUser } from "@/lib/session";

/** Páginas comerciales: precios y contratación. Se ven con o sin sesión. */
export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  const { user, demo } = await getAuthUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      {demo ? <DemoBanner current={demo} personas={DEMO_PERSONAS} /> : null}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/precios" aria-label="Wattalis · planes y precios">
            <Wordmark className="text-xl" />
          </Link>
          <nav aria-label="Comercial" className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/precios" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink sm:inline-flex">
              Planes y precios
            </Link>
            {user ? (
              <Link href="/inicio" className={buttonClass("secondary", "sm")}>
                Ir a mi espacio
              </Link>
            ) : (
              <>
                <Link href="/iniciar-sesion" className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink">
                  Iniciar sesión
                </Link>
                <Link href="/suscripcion/seleccionar" className={buttonClass("primary", "sm")}>
                  Empezar
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted sm:px-6">
          <p>
            <Wordmark className="mr-2 text-sm" />
            Software de gestión para hospitales, clínicas y consultorios.
          </p>
          <p>Precios, límites y funciones ilustrativos; pueden cambiar. Modo demostración: no se realizan cobros.</p>
        </div>
      </footer>
    </div>
  );
}
