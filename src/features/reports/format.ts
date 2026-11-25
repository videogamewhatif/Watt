// Cómo se ve cada valor de un reporte en pantalla y en CSV. Las fechas ya vienen
// en hora local del espacio ("YYYY-MM-DD" o "YYYY-MM-DDTHH:MM"), así que aquí
// solo se les da formato (en UTC, para que la zona del servidor no intervenga).
import { formatMoney } from "@/lib/money";
import type { Cell, Format, ReportTable } from "./model";

const LOCALE = "es-MX";
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });

const asDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
/** "3 de nov de 2026" → "3 nov 2026": más compacto en columnas. */
const compactDate = (fmt: Intl.DateTimeFormat, value: string) => fmt.format(asDate(value)).replace(/ de /g, " ");
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Texto para mostrar en pantalla o en impresión. */
export function formatCell(value: Cell, format: Format = "text"): string {
  if (value === null || value === "") return "—";
  if (typeof value === "string" && format !== "date" && format !== "month" && format !== "datetime") return value;
  switch (format) {
    case "int":
      return integer.format(Number(value));
    case "money":
      return formatMoney(Number(value));
    case "pct":
      return percent.format(Number(value));
    case "hours":
      return `${oneDecimal.format(Number(value))} h`;
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? compactDate(dateFmt, String(value)) : String(value);
    case "month":
      return /^\d{4}-\d{2}/.test(String(value)) ? capitalize(monthFmt.format(asDate(`${String(value).slice(0, 7)}-01`))) : String(value);
    case "datetime": {
      const text = String(value);
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? `${compactDate(dateTimeFmt, text)}, ${text.slice(11, 16)}` : text;
    }
    default:
      return String(value);
  }
}

/** Los números se alinean a la derecha. */
export function isNumeric(format: Format = "text") {
  return format === "int" || format === "money" || format === "pct" || format === "hours";
}

// ---------------------------------------------------------------------------
// CSV (abre bien en Excel y Hojas de cálculo: UTF-8 con BOM, coma y CRLF)
// ---------------------------------------------------------------------------
const UNIT: Partial<Record<Format, string>> = { money: "MXN", pct: "%", hours: "h" };

/** Valor crudo para CSV: números sin formato y fechas ISO. */
export function csvValue(value: Cell, format: Format = "text"): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    switch (format) {
      case "money":
        return value.toFixed(2);
      case "pct":
        return (Math.round(value * 1000) / 10).toFixed(1);
      case "hours":
        return (Math.round(value * 10) / 10).toFixed(1);
      default:
        return String(value);
    }
  }
  if (format === "datetime" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.replace("T", " ");
  if (format === "month" && /^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
  // Evita que una hoja de cálculo interprete un nombre como fórmula.
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function tableToCsv(table: Pick<ReportTable, "columns" | "rows" | "total">): string {
  const header = table.columns.map((c) => quote(UNIT[c.format ?? "text"] ? `${c.label} (${UNIT[c.format ?? "text"]})` : c.label));
  const line = (values: Record<string, Cell>) => table.columns.map((c) => quote(csvValue(values[c.key] ?? null, c.format))).join(",");
  const lines = [header.join(","), ...table.rows.map((r) => line(r.values))];
  if (table.total && table.rows.length) lines.push(line(table.total));
  return `${lines.join("\r\n")}\r\n`;
}

/** Nombre de archivo seguro: "ventas_por-cajero_2026-11-01_2026-11-21.csv". */
export function csvFilename(reportKey: string, tableId: string, from: string, to: string): string {
  const safe = (s: string) => s.replace(/[^a-z0-9-]/gi, "");
  return `${safe(reportKey)}_${safe(tableId)}_${safe(from)}_${safe(to)}.csv`;
}
