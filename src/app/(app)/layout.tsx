import { DemoBanner } from "@/components/shell/demo-banner";
import { UserMenu, WorkspaceSwitcher } from "@/components/shell/menus";
import { BottomNav, SidebarNav } from "@/components/shell/nav";
import { PracticeSwitcher } from "@/components/shell/practice-switcher";
import { Wordmark } from "@/components/ui/layout";
import { ToastProvider } from "@/components/ui/toast";
import { navigationFor } from "@/lib/permissions";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { getAppContext, getAuthUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  const { demo } = await getAuthUser();
  const items = navigationFor(ctx.role);
  const active = { id: ctx.workspace.id, name: ctx.workspace.name, role: ctx.role };
  const options = ctx.workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }));

  return (
    <ToastProvider>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
        <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
          <div className="px-5 pt-5 pb-4">
            <Wordmark className="text-xl" />
          </div>
          <div className="px-3 pb-4">
            <PracticeSwitcher />
          </div>
          <div className="flex-1 overflow-y-auto px-3">
            <SidebarNav items={items} />
          </div>
          <p className="px-5 py-4 text-xs text-muted">Zona horaria: {ctx.workspace.timezone.replace("_", " ")}</p>
        </aside>
        <div className="flex min-w-0 flex-col">
          {demo ? <DemoBanner current={demo} personas={DEMO_PERSONAS} /> : null}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur sm:px-5">
            <Wordmark className="text-lg md:hidden" />
            <PracticeSwitcher className="w-32 md:hidden" />
            <div className="min-w-0 flex-1">
              <WorkspaceSwitcher active={active} workspaces={options} />
            </div>
            <UserMenu name={ctx.user.fullName} email={ctx.user.email} />
          </header>
          {/* La clave por espacio reinicia formularios y selecciones al cambiar de espacio. */}
          <main id="contenido" key={ctx.workspace.id} className="min-w-0 flex-1 px-3 pt-5 pb-24 sm:px-5 md:pb-10 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <BottomNav items={items} />
    </ToastProvider>
  );
}
