// Forma común de todos los reportes. Cada reporte se calcula como indicadores,
// gráficas y tablas con datos simples (serializables): la misma estructura se
// dibuja en pantalla, se imprime y se exporta a CSV sin código por reporte.

/**
 * Cómo se muestra un valor:
 * - money: pesos (número).
 * - pct: fracción 0…1 (null = no aplica).
 * - hours: horas con un decimal (número).
 * - date: "YYYY-MM-DD" (fecha local del espacio).
 * - month: "YYYY-MM-DD" del día 1 (se muestra como mes y año).
 * - datetime: "YYYY-MM-DDTHH:MM" (fecha y hora locales del espacio).
 */
export type Format = "text" | "int" | "money" | "pct" | "hours" | "date" | "month" | "datetime";

export type Cell = string | number | null;

export type Column = {
  key: string;
  label: string;
  format?: Format;
  /** Columna de apoyo: se oculta en pantallas angostas (sigue en impresión y CSV). */
  secondary?: boolean;
};

export type TableRow = {
  values: Record<string, Cell>;
  /** Enlace al detalle (cobro, turno, paciente, profesional). */
  href?: string;
  /** Fila atenuada (p. ej. un turno todavía abierto). */
  muted?: boolean;
};

export type ReportTable = {
  /** Identifica la tabla al exportarla (`?tabla=`). */
  id: string;
  title: string;
  description?: string;
  columns: Column[];
  rows: TableRow[];
  total?: Record<string, Cell>;
  /** Texto cuando no hay filas. */
  empty: string;
  /** En pantalla se muestran solo las primeras N filas; el CSV las trae todas. */
  preview?: number;
};

export type Kpi = { label: string; value: Cell; format: Format; hint?: string; strong?: boolean };

export type ChartPoint = { label: string; value: number; hint?: string };

type ChartBase = { id: string; title: string; description?: string };

export type Chart =
  /** Una serie a lo largo del tiempo (columnas verticales). */
  | (ChartBase & { kind: "columns"; format: Format; points: ChartPoint[] })
  /** Comparación entre categorías (barras horizontales). */
  | (ChartBase & { kind: "bars"; format: Format; points: ChartPoint[]; max?: number })
  /** Un total repartido en partes (barra segmentada con leyenda). */
  | (ChartBase & { kind: "segments"; parts: { key: string; label: string; value: number }[] })
  /** Intensidad por día de la semana y hora. */
  | (ChartBase & { kind: "heatmap"; rowLabels: string[]; colLabels: string[]; values: number[][] });

export type ReportResult = {
  kpis: Kpi[];
  charts: Chart[];
  tables: ReportTable[];
  /** Aclaraciones de cómo se calculó (se muestran al pie). */
  notes: string[];
};

export type LoadedReport = ReportResult & {
  /** Alguna consulta falló: el reporte puede estar incompleto. */
  error: boolean;
  /** Se alcanzó el máximo de filas que se leen por consulta. */
  truncated: boolean;
};

export const EMPTY_REPORT: ReportResult = { kpis: [], charts: [], tables: [], notes: [] };
