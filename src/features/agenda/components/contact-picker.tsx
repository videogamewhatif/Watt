"use client";

import { Search, UserPlus, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ContactSummary } from "@/features/patients/actions";
import { ContactEditor } from "@/features/patients/contact-editor";
import { searchContacts } from "../actions";

type Props = {
  organizationId: string;
  value: ContactSummary | null;
  onChange: (contact: ContactSummary | null) => void;
  error?: string;
};

/** Busca un paciente o lo registra sin salir del formulario de la cita. */
export function ContactPicker({ organizationId, value, onChange, error }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();
  const errorId = useId();

  useEffect(() => {
    if (value || creating) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchContacts(organizationId, query);
      if (cancelled) return;
      setLoading(false);
      setFailed(!result.ok);
      setResults(result.ok ? result.data : []);
      setActive(-1);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [organizationId, query, value, creating]);

  if (value) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium" id={labelId}>
          Paciente o contacto <span className="text-red-700">*</span>
        </p>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line-strong bg-brand-50/40 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="size-4 shrink-0 text-brand-700" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">{value.full_name}</span>
              <span className="block truncate text-xs text-muted">{[value.phone, value.email].filter(Boolean).join(" · ")}</span>
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Cambiar
          </Button>
        </div>
      </div>
    );
  }

  if (creating) {
    const digits = query.replace(/\D/g, "");
    return (
      <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
        <p className="text-sm font-semibold">Registrar nuevo contacto</p>
        <p className="text-xs text-muted">Los demás datos de la cita se conservan.</p>
        <ContactEditor
          organizationId={organizationId}
          initial={digits.length >= 7 ? { phone: query } : query.includes("@") ? { email: query } : { full_name: query }}
          submitLabel="Guardar y usar en la cita"
          onSaved={(c) => {
            setCreating(false);
            onChange(c);
          }}
          onUseExisting={(c) => {
            setCreating(false);
            onChange(c);
          }}
          onCancel={() => setCreating(false)}
        />
      </div>
    );
  }

  const choose = (contact: ContactSummary) => {
    onChange(contact);
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={`${listId}-input`} id={labelId} className="block text-sm font-medium">
        Paciente o contacto <span className="text-red-700">*</span>
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          placeholder="Busca por nombre, teléfono o correo"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && active >= 0 && results[active]) {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape" && (open || query)) {
              // Cierra la lista (o limpia la búsqueda) sin cerrar el formulario de la cita.
              e.preventDefault();
              e.stopPropagation();
              if (open) setOpen(false);
              else setQuery("");
            }
          }}
          className={`block h-10 w-full rounded-lg border bg-surface pr-3 pl-9 text-sm ${error ? "border-red-600 ring-1 ring-red-600" : "border-line-strong"}`}
        />
        {open ? (
          <ul id={listId} role="listbox" aria-labelledby={labelId} className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
            {loading && results.length === 0 ? <li className="px-3 py-2 text-sm text-muted">Buscando…</li> : null}
            {failed ? <li className="px-3 py-2 text-sm text-red-700">No pudimos buscar. Intenta de nuevo.</li> : null}
            {!loading && !failed && results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">{query ? "Sin coincidencias." : "Aún no hay contactos."}</li>
            ) : null}
            {results.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${i === active ? "bg-brand-50" : "hover:bg-sunken"}`}
              >
                <span className="block font-medium">{c.full_name}</span>
                <span className="block text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <Button size="sm" variant="subtle" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
        Registrar nuevo contacto
      </Button>
    </div>
  );
}
