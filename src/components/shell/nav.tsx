"use client";

import { CalendarDays, ClipboardList, Contact, Home, Settings, Stethoscope } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/permissions";

const ICONS = { home: Home, calendar: CalendarDays, users: Stethoscope, contacts: Contact, services: ClipboardList, settings: Settings };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
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
        })}
      </ul>
    </nav>
  );
}

/** Navegación compacta inferior para teléfonos. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium ${active ? "text-brand-700" : "text-muted"}`}
              >
                <Icon className="size-5" aria-hidden />
                <span className="max-w-full truncate">{item.label.replace("Configuración", "Ajustes")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
