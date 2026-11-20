// Fechas y horas del espacio de trabajo.
//
// Las fechas locales se manejan como cadenas "YYYY-MM-DD" y las horas como "HH:MM".
// Todos los cálculos usan explícitamente la zona del espacio (Intl) o aritmética en
// UTC sobre fechas sin hora, así que la zona del navegador o del servidor nunca
// cambia lo que se muestra.

export type LocalDate = string;

const LOCALE = "es-MX";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

function toUtcDate(date: LocalDate): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Fecha inválida: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtcDate(d: Date): LocalDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(date: LocalDate): number {
  const day = toUtcDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function zonedParts(instant: Date, timeZone: string): Parts {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out as Parts;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha y hora locales de un instante en la zona indicada. */
export function localParts(instant: Date | string, timeZone: string): { date: LocalDate; time: string; minutes: number } {
  const p = zonedParts(typeof instant === "string" ? new Date(instant) : instant, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, minutes: p.hour * 60 + p.minute };
}

export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  return localParts(now, timeZone).date;
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Convierte una fecha y hora locales del espacio en un instante absoluto. */
export function zonedToInstant(date: LocalDate, time: string, timeZone: string): Date {
  const d = toUtcDate(date);
  const [h, m] = time.split(":").map(Number);
  const guess = d.getTime() + (h * 60 + m) * 60000;
  const first = offsetMinutes(new Date(guess), timeZone);
  let instant = guess - first * 60000;
  const second = offsetMinutes(new Date(instant), timeZone);
  if (second !== first) instant = guess - second * 60000;
  return new Date(instant);
}

export function minutesOf(time: string): number {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${pad(h)}:${pad(minutes % 60)}`;
}

/** "2026-11-19T10:30" → { date: "2026-11-19", time: "10:30" } */
export function splitLocal(local: string): { date: LocalDate; time: string } {
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Las fechas sin hora se formatean como medianoche UTC con timeZone UTC: estable en cualquier zona.
const longDate = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const mediumDate = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });

/** "Miércoles, 19 de noviembre de 2026" */
export function formatLongDate(date: LocalDate): string {
  return capitalize(longDate.format(toUtcDate(date)));
}

/** "Miércoles, 19 de noviembre" */
export function formatMediumDate(date: LocalDate): string {
  return capitalize(mediumDate.format(toUtcDate(date)));
}

/** "mié, 19 nov" */
export function formatShortDate(date: LocalDate): string {
  return shortDate.format(toUtcDate(date));
}

export function formatMonthYear(date: LocalDate): string {
  return capitalize(monthYear.format(toUtcDate(date)));
}

/** Rango de semana legible: "17 – 23 de noviembre de 2026". */
export function formatWeekRange(from: LocalDate, to: LocalDate): string {
  const a = toUtcDate(from);
  const b = toUtcDate(to);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const day = new Intl.DateTimeFormat(LOCALE, { day: "numeric", timeZone: "UTC" });
  const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", timeZone: "UTC" });
  const full = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return sameMonth ? `${day.format(a)} – ${full.format(b)}` : `${dayMonth.format(a)} – ${full.format(b)}`;
}

/** Fecha y hora de un instante en la zona del espacio: "19 nov 2026, 10:32". */
export function formatInstant(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(typeof instant === "string" ? new Date(instant) : instant);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Zonas sugeridas para espacios en México; se acepta cualquier zona IANA válida. */
export const MEXICO_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Mexico_City", label: "Centro (Ciudad de México, Guadalajara, Monterrey)" },
  { value: "America/Cancun", label: "Sureste (Cancún, Quintana Roo)" },
  { value: "America/Mazatlan", label: "Pacífico (Mazatlán, La Paz)" },
  { value: "America/Hermosillo", label: "Sonora (Hermosillo)" },
  { value: "America/Tijuana", label: "Noroeste (Tijuana, Mexicali)" },
  { value: "America/Chihuahua", label: "Chihuahua" },
  { value: "America/Ciudad_Juarez", label: "Ciudad Juárez" },
  { value: "America/Matamoros", label: "Frontera noreste (Matamoros, Nuevo Laredo)" },
];
