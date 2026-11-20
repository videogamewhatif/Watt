"use client";

import { FlaskConical, LogOut, RotateCcw } from "lucide-react";
import { useTransition } from "react";
import { enterDemo, exitDemo, resetDemo } from "@/lib/demo/actions";
import type { DemoPersona } from "@/lib/demo/personas";

/** Aviso permanente del modo de prueba, con cambio de persona para recorrer cada rol. */
export function DemoBanner({ current, personas }: { current: DemoPersona; personas: DemoPersona[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <div role="region" aria-label="Modo de prueba" className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 font-semibold">
          <FlaskConical className="size-4 shrink-0" aria-hidden />
          Modo de prueba
          <span className="font-normal">· datos ficticios en memoria; no se guarda nada en una base real.</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="demo-persona" className="font-medium">
            Ver como
          </label>
          <select
            id="demo-persona"
            value={current.key}
            disabled={pending}
            onChange={(e) => startTransition(() => enterDemo(e.target.value))}
            className="h-8 max-w-[18rem] rounded-lg border border-amber-300 bg-white px-2 text-sm"
          >
            {personas.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => resetDemo())}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-medium hover:bg-amber-100 disabled:opacity-60"
          >
            <RotateCcw className="size-4" aria-hidden /> Reiniciar datos
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => exitDemo())}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-medium hover:bg-amber-100 disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden /> Salir de pruebas
          </button>
        </div>
      </div>
    </div>
  );
}
