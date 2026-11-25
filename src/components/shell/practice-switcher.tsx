"use client";

import { Check, ChevronDown, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setPracticeArea } from "@/features/practice/actions";
import { ALL_AREAS } from "@/lib/practice";

type Area = { key: string; label: string; color?: string };

/**
 * Selector de área de atención (Hospital, Dentista, …). Solo lista las áreas en
 * las que el espacio tiene profesionales; al elegir una, la agenda y la lista de
 * profesionales muestran únicamente a los de esa área.
 */
export function PracticeSwitcher({ areas, active, className = "" }: { areas: Area[]; active: string | null; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const options: Area[] = areas.length > 1 ? [{ key: ALL_AREAS, label: "Todas las áreas" }, ...areas] : areas;
  const current = active ?? (areas.length === 1 ? areas[0].key : ALL_AREAS);
  const selected = options.find((o) => o.key === current);
  const label = selected?.label ?? "Todas las áreas";

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

  if (options.length === 0) return null;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Área de atención: ${label}`}
        aria-busy={pending}
        disabled={options.length < 2}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-default disabled:hover:bg-brand-50"
      >
        {/* Solo el ícono toma el color del área; el resto conserva el tema. */}
        <Stethoscope className="size-4 shrink-0" style={selected?.color ? { color: selected.color } : undefined} aria-hidden />
        <span className={`min-w-0 flex-1 truncate text-left ${pending ? "opacity-60" : ""}`}>{label}</span>
        {options.length > 1 ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : null}
      </button>
      {open ? (
        <ul role="menu" className="absolute left-0 z-40 mt-1 w-full min-w-44 rounded-xl border border-line bg-surface p-1 shadow-xl">
          {options.map((o) => (
            <li key={o.key} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={o.key === current}
                onClick={() => {
                  setOpen(false);
                  if (o.key === current) return;
                  startTransition(async () => {
                    await setPracticeArea(o.key);
                    router.refresh();
                  });
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`size-2.5 shrink-0 rounded-full ${o.color ? "" : "border border-brand-300 bg-brand-100"}`}
                    style={o.color ? { background: o.color } : undefined}
                  />
                  {o.label}
                </span>
                {o.key === current ? <Check className="size-4 text-brand-700" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
