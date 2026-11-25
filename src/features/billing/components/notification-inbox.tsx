"use client";

import { Inbox, Mail } from "lucide-react";
import { useState } from "react";

export type InboxItem = { id: string; label: string; subject: string; recipient: string; dateLabel: string; html: string; text: string; organization?: string };

/**
 * Bandeja de avisos de DEMOSTRACIÓN con vista previa del correo. Ningún aviso
 * sale de la aplicación hasta configurar Amazon SES con un dominio verificado.
 */
export function NotificationInbox({ items }: { items: InboxItem[] }) {
  const [selected, setSelected] = useState(items[0]?.id ?? null);
  const [mode, setMode] = useState<"html" | "text">("html");
  const current = items.find((i) => i.id === selected) ?? null;
  if (!items.length) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
        <Inbox className="size-8 text-muted" aria-hidden />
        <p className="mt-2 font-medium text-ink">Sin avisos todavía</p>
        <p className="text-sm text-muted">Aquí aparecerán los correos de suscripción que se enviarían.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <ul className="max-h-[32rem] space-y-1 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5" aria-label="Avisos">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => setSelected(i.id)}
              aria-current={i.id === selected ? "true" : undefined}
              className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${i.id === selected ? "bg-brand-50 ring-1 ring-brand-300" : "hover:bg-sunken"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-ink">{i.label}</span>
                <span className="shrink-0 text-xs text-muted">{i.dateLabel}</span>
              </span>
              <span className="block truncate text-xs text-muted">{i.organization ? `${i.organization} · ` : ""}{i.subject}</span>
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <section aria-label="Vista previa del correo" className="overflow-hidden rounded-2xl border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-semibold text-ink">
                <Mail className="size-4 shrink-0 text-brand-700" aria-hidden />
                {current.subject}
              </p>
              <p className="truncate text-xs text-muted">
                Para: {current.recipient} · <span className="font-medium text-amber-800">No enviado (demostración)</span>
              </p>
            </div>
            <div role="group" aria-label="Formato de vista previa" className="inline-flex rounded-lg bg-sunken p-0.5 text-xs font-medium">
              {(["html", "text"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                  {m === "html" ? "Correo" : "Texto"}
                </button>
              ))}
            </div>
          </header>
          {mode === "html" ? (
            // sandbox sin permisos: el HTML no ejecuta scripts ni navega.
            <iframe title={`Vista previa: ${current.subject}`} sandbox="" srcDoc={current.html} className="h-[28rem] w-full bg-canvas" />
          ) : (
            <pre className="h-[28rem] overflow-auto p-4 text-sm whitespace-pre-wrap text-ink-soft">{current.text}</pre>
          )}
        </section>
      ) : null}
    </div>
  );
}
