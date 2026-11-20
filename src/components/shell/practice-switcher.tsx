"use client";

import { Check, ChevronDown, Stethoscope } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Tipo de práctica mostrado en la barra lateral.
 * Para habilitar otro tipo, cambia `enabled` a true: aparecerá en el menú.
 */
export const PRACTICES = [
  { key: "medico", label: "Médico", enabled: true },
  { key: "veterinario", label: "Veterinario", enabled: false },
  { key: "dentista", label: "Dentista", enabled: false },
  { key: "psicologo", label: "Psicólogo", enabled: false },
  { key: "nutricion", label: "Nutrición", enabled: false },
] as const;

export type PracticeKey = (typeof PRACTICES)[number]["key"];

export function PracticeSwitcher({ className = "" }: { className?: string }) {
  const available = PRACTICES.filter((p) => p.enabled);
  const [current, setCurrent] = useState<PracticeKey>(available[0].key);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = PRACTICES.find((p) => p.key === current)!;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tipo de práctica: ${active.label}`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100"
      >
        <Stethoscope className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">{active.label}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </button>
      {open ? (
        <ul role="menu" className="absolute left-0 z-40 mt-1 w-full min-w-40 rounded-xl border border-line bg-surface p-1 shadow-xl">
          {available.map((p) => (
            <li key={p.key} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={p.key === current}
                onClick={() => {
                  setCurrent(p.key);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken"
              >
                {p.label}
                {p.key === current ? <Check className="size-4 text-brand-700" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
