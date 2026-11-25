/**
 * Áreas de atención (apartados) que se eligen en la barra lateral.
 * Cada área agrupa a los profesionales de un tipo: al elegir "Dentista" la
 * agenda y la lista de profesionales solo muestran dentistas.
 * Un espacio solo ve las áreas en las que tiene profesionales activos.
 *
 * `color` identifica el área solo en detalles pequeños (ícono del selector,
 * puntos indicadores); el tema de la interfaz no cambia. Todos tienen
 * contraste suficiente sobre fondo claro.
 */
export const PRACTICE_AREAS = [
  { key: "medico", label: "Hospital", color: "#dc2626" },
  { key: "nutriologo", label: "Nutriólogo", color: "#16a34a" },
  { key: "psicologo", label: "Psicólogo", color: "#7c3aed" },
  { key: "dentista", label: "Dentista", color: "#0284c7" },
  { key: "optica", label: "Óptica", color: "#d97706" },
] as const;

export type PracticeArea = { key: PracticeKey; label: string; color: string };

export type PracticeKey = (typeof PRACTICE_AREAS)[number]["key"];

/** Valor que representa "todas las áreas" (sin filtro). */
export const ALL_AREAS = "todas";

export const PRACTICE_COOKIE = "wattalis_area";

export function isPracticeKey(value: unknown): value is PracticeKey {
  return PRACTICE_AREAS.some((a) => a.key === value);
}

/** Áreas disponibles según los tipos de los profesionales activos del espacio. */
export function availableAreas(professionalTypes: Iterable<string>) {
  const types = new Set(professionalTypes);
  return PRACTICE_AREAS.filter((a) => types.has(a.key));
}

/**
 * Área efectiva: la guardada si sigue disponible en el espacio; si no, ninguna
 * (todas). Con una sola área disponible no tiene caso filtrar.
 */
export function resolveArea(saved: string | undefined, available: readonly { key: string }[]): PracticeKey | null {
  if (available.length < 2) return null;
  return available.some((a) => a.key === saved) && isPracticeKey(saved) ? saved : null;
}
