"use client";

import { Building2, Check, ChevronDown, LogOut, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useTransition } from "react";
import { signOut } from "@/features/auth/actions";
import { switchWorkspace } from "@/features/workspaces/actions";
import type { MemberRole } from "@/lib/database.types";
import { ROLE_LABEL } from "@/lib/labels";

/** <details> nativo (accesible por teclado) que se cierra al hacer clic fuera o con Esc. */
function useDismiss() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return ref;
}

type WorkspaceOption = { id: string; name: string; role: MemberRole };

export function WorkspaceSwitcher({ active, workspaces }: { active: WorkspaceOption; workspaces: WorkspaceOption[] }) {
  const ref = useDismiss();
  const [pending, startTransition] = useTransition();
  return (
    <details ref={ref} className="relative min-w-0">
      <summary
        className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-sunken [&::-webkit-details-marker]:hidden"
        aria-label={`Espacio de trabajo activo: ${active.name}. Cambiar de espacio`}
      >
        <Building2 className="size-4 shrink-0 text-brand-700" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{active.name}</span>
          <span className="block text-xs text-muted">{ROLE_LABEL[active.role]}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </summary>
      <div className="absolute left-0 z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 shadow-xl">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium tracking-wide text-muted uppercase">Tus espacios</p>
        <ul>
          {workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (w.id === active.id) {
                    if (ref.current) ref.current.open = false;
                    return;
                  }
                  if (ref.current) ref.current.open = false;
                  startTransition(() => switchWorkspace(w.id));
                }}
                aria-current={w.id === active.id ? "true" : undefined}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-sunken disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="block text-xs text-muted">{ROLE_LABEL[w.role]}</span>
                </span>
                {w.id === active.id ? <Check className="size-4 text-brand-700" aria-label="Activo" /> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          <Link href="/bienvenida?nuevo=1" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-soft hover:bg-sunken">
            <Plus className="size-4" aria-hidden />
            Crear otro espacio
          </Link>
        </div>
      </div>
    </details>
  );
}

export function UserMenu({ name, email }: { name: string; email: string }) {
  const ref = useDismiss();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <details ref={ref} className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-full p-0.5 hover:bg-sunken [&::-webkit-details-marker]:hidden"
        aria-label={`Cuenta de ${name}`}
      >
        <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
          {initials || <UserRound className="size-4" />}
        </span>
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
        <Link href="/configuracion#mi-cuenta" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-sunken">
          <UserRound className="size-4" aria-hidden />
          Mi cuenta
        </Link>
        <form action={signOut}>
          <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-sunken">
            <LogOut className="size-4" aria-hidden />
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
