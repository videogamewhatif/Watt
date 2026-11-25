"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/field";
import { formatMoney, parseMoney, toCents } from "@/lib/money";

/** Conteo de prueba a mitad del turno: compara contra lo esperado sin guardar nada. */
export function PreCount({ expectedCash }: { expectedCash: number }) {
  const [counted, setCounted] = useState("");
  const value = counted.trim() === "" ? null : parseMoney(counted);
  const difference = value === null ? null : (toCents(value) - toCents(expectedCash)) / 100;

  return (
    <div className="space-y-3">
      <TextField
        label="Efectivo contado ahora (MXN)"
        inputMode="decimal"
        placeholder="0.00"
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
        error={counted !== "" && value === null ? "Escribe un importe válido." : undefined}
        hint="Solo para verificar: el precorte no cierra el turno ni guarda el conteo."
      />
      <div aria-live="polite" className="text-sm">
        {difference === null ? null : difference === 0 ? (
          <p className="font-medium text-emerald-800">La caja cuadra.</p>
        ) : (
          <p className="font-medium text-amber-900">
            {difference > 0 ? "Sobran" : "Faltan"} {formatMoney(Math.abs(difference))}
          </p>
        )}
      </div>
    </div>
  );
}
