"use client";

import { useEffect, useState } from "react";

/**
 * Lleva al panel principal tras unos segundos, con cuenta regresiva visible y
 * opción de quedarse (WCAG 2.2.1: el usuario puede detener el límite de tiempo).
 */
export function AutoRedirect({ action, seconds = 10 }: { action: () => Promise<void>; seconds?: number }) {
  const [left, setLeft] = useState(seconds);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (stopped) return;
    if (left <= 0) {
      void action();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, stopped, action]);
  if (stopped) return null;
  return (
    <p className="text-sm text-muted">
      Te llevaremos a tu espacio de trabajo en <span className="tabular font-medium text-ink">{Math.max(left, 0)}</span> s.{" "}
      <button type="button" onClick={() => setStopped(true)} className="font-medium text-brand-700 underline-offset-4 hover:underline">
        Quedarme aquí
      </button>
    </p>
  );
}
