"use client";

import { CalendarClock, CalendarDays, ChartColumn, ChevronDown, ClipboardList, Contact, Ellipsis, Home, Settings, Stethoscope, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import type { NavItem, NavLink, NavSection } from "@/lib/permissions";

const ICONS = { home: Home, calendar: CalendarDays, schedule: CalendarClock, users: Stethoscope, contacts: Contact, cash: Wallet, services: ClipboardList, reports: ChartColumn, settings: Settings };

function isActive(pathname: string, href: string, link?: Pick<NavLink, "exact" | "alsoActive">) {
  if (link?.exact) return pathname === href;
  const match = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  return match(href) || Boolean(link?.alsoActive?.some(match));
}

/** Árbol de menús: los grupos con submenú se despliegan y se pliegan. */
function NavTree({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Sin elección explícita, un grupo está abierto si contiene la página actual.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);

        if (!item.children?.length) {
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-brand-700 text-white" : "text-ink-soft hover:bg-sunken hover:text-ink"
                }`}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        }

        const open = expanded[item.href] ?? active;
        const groupId = `nav-${item.href.replace(/\W/g, "")}`;
        return (
          <li key={item.href}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={groupId}
              onClick={() => setExpanded((e) => ({ ...e, [item.href]: !open }))}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-sunken ${active ? "text-ink" : "text-ink-soft hover:text-ink"}`}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
            <ul id={groupId} hidden={!open} className="mt-0.5 ml-5 space-y-0.5 border-l border-line pl-2">
              {item.children.map((child) => {
                const childActive = isActive(pathname, child.href, child);
                return (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={childActive ? "page" : undefined}
                      className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        childActive ? "bg-brand-700 font-medium text-white" : "text-ink-soft hover:bg-sunken hover:text-ink"
                      }`}
                    >
                      {child.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
      {children}
    </h2>
  );
}

/**
 * Barra lateral en bloques: Inicio · Área de atención (selector y lo que filtra)
 * · Toda la clínica (igual en todas las áreas) · Configuración, fija abajo.
 * Sin selector de área (rol Profesional o espacio sin áreas) no hay bloque de
 * área: esas opciones se muestran junto a Inicio.
 */
export function SidebarNav({ items, areaSwitcher, areaColor }: { items: NavItem[]; areaSwitcher?: ReactNode; areaColor?: string | null }) {
  const of = (section: NavSection) => items.filter((i) => i.section === section);
  // Sin selector, el orden original se conserva (p. ej. Agenda y luego Mi horario).
  const general = areaSwitcher ? of("general") : items.filter((i) => i.section === "general" || i.section === "area");
  const area = areaSwitcher ? of("area") : [];
  const clinic = of("clinic");
  const settings = of("settings");

  return (
    <nav aria-label="Principal" className="flex min-h-full flex-col gap-4 pb-2">
      {general.length ? <NavTree items={general} /> : null}

      {areaSwitcher ? (
        <section aria-labelledby="nav-area" className="border-t border-line pt-4">
          <SectionTitle id="nav-area">Área de atención</SectionTitle>
          {/* La línea lateral (color del área) une el selector con lo que filtra. */}
          <div
            className={`space-y-1.5 border-l-2 pl-2 ${areaColor ? "" : "border-brand-200"}`}
            style={areaColor ? { borderColor: areaColor } : undefined}
          >
            {areaSwitcher}
            <NavTree items={area} />
          </div>
        </section>
      ) : null}

      {clinic.length ? (
        <section aria-labelledby="nav-clinic" className="border-t border-line pt-4">
          <SectionTitle id="nav-clinic">Toda la clínica</SectionTitle>
          <NavTree items={clinic} />
        </section>
      ) : null}

      {settings.length ? (
        <div className="mt-auto border-t border-line pt-3">
          <NavTree items={settings} />
        </div>
      ) : null}
    </nav>
  );
}

/** Pestañas de un submenú (en teléfonos, donde no hay barra lateral). */
export function SubNav({ label, items }: { label: string; items: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-3 mb-5 overflow-x-auto px-3 print:hidden md:hidden">
      <ul className="flex gap-1 rounded-xl bg-sunken p-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-1.5 text-center text-sm font-medium whitespace-nowrap ${active ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Lo que más se usa en el teléfono va siempre en la barra; el resto, en «Más». */
const PRIMARY = ["/inicio", "/agenda", "/ventas", "/pacientes"];
const MAX_TABS = 5;

/** Navegación compacta inferior para teléfonos. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const overflow = items.length > MAX_TABS;
  const primary = overflow ? [...items].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_TABS - 1) : items;
  const rest = overflow ? items.filter((i) => !primary.includes(i)) : [];
  const moreActive = rest.some((i) => isActive(pathname, i.href));
  const tabs = primary.length + (overflow ? 1 : 0);
  const tabClass = (active: boolean) => `flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium ${active ? "text-brand-700" : "text-muted"}`;

  return (
    <>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 print:hidden border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs}, minmax(0, 1fr))` }}>
          {items
            .filter((i) => primary.includes(i))
            .map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link href={item.children?.[0]?.href ?? item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                    <Icon className="size-5" aria-hidden />
                    <span className="max-w-full truncate">{item.label.replace("Configuración", "Ajustes")}</span>
                  </Link>
                </li>
              );
            })}
          {overflow ? (
            <li>
              <button type="button" aria-haspopup="dialog" onClick={() => setMoreOpen(true)} className={tabClass(moreActive)}>
                <Ellipsis className="size-5" aria-hidden />
                <span>Más</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
      {overflow ? (
        <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Más opciones" size="sm">
          <nav aria-label="Más opciones">
            <NavTree items={rest} onNavigate={() => setMoreOpen(false)} />
          </nav>
        </Dialog>
      ) : null}
    </>
  );
}

function rank(item: NavItem) {
  const i = PRIMARY.indexOf(item.href);
  return i === -1 ? PRIMARY.length : i;
}
