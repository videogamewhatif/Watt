"use client";

import { CircleCheck, X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

type Toast = { id: number; message: ReactNode };
type ToastApi = { notify: (message: ReactNode) => void };

const ToastContext = createContext<ToastApi>({ notify: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/** Avisos breves anunciados a lectores de pantalla (aria-live). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const notify = useCallback(
    (message: ReactNode) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { id, message }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext value={api}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
            <div className="min-w-0 flex-1">{t.message}</div>
            <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-white/70 hover:text-white" aria-label="Cerrar aviso">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
