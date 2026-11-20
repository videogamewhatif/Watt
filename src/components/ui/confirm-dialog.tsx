"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Confirmación para acciones con consecuencias (cancelar cita, desactivar, quitar miembro). */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Volver", tone = "danger", pending, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} pending={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-soft">{children}</div>
    </Dialog>
  );
}
