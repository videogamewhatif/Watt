"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "drawer" abre un panel lateral (detalle y formularios largos); "center" un modal. */
  variant?: "center" | "drawer";
  size?: "sm" | "md" | "lg";
};

/**
 * Diálogo accesible sobre <dialog> nativo: atrapa el foco, cierra con Esc y
 * devuelve el foco al elemento que lo abrió.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "center", size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, []);

  const widths = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" };
  const placement =
    variant === "drawer"
      ? `drawer m-0 ml-auto h-dvh max-h-dvh w-full max-w-full ${widths[size]} rounded-none sm:rounded-l-2xl`
      : `m-auto max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] ${widths[size]} rounded-2xl`;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={`${placement} flex-col bg-surface p-0 text-ink shadow-2xl open:flex`}
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === ref.current;
      }}
      onClick={(event) => {
        // Solo cierra si el clic empezó y terminó en el fondo (no al arrastrar una selección de texto).
        if (event.target === ref.current && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {open ? (
        <>
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink" aria-label="Cerrar">
              <X className="size-5" aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
        </>
      ) : null}
    </dialog>
  );
}
