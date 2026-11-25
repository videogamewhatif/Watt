"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/configuracion/suscripcion", label: "Mi plan", exact: true },
  { href: "/configuracion/facturacion", label: "Facturación" },
  { href: "/configuracion/suscripcion/metodos-de-pago", label: "Métodos de pago" },
  { href: "/configuracion/suscripcion/renovacion", label: "Renovación" },
  { href: "/configuracion/suscripcion/avisos", label: "Avisos" },
];

/** Pestañas de Suscripción y facturación. Se desplazan de lado en teléfonos. */
export function BillingTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Suscripción y facturación" className="-mx-3 mb-6 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  active ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
