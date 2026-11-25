// Catálogo de reportes y quién puede verlos. Es solo presentación: los datos se
// leen con la sesión de la persona, así que RLS limita lo que cada rol obtiene
// aunque alguien escriba la URL a mano (p. ej. Profesional no lee la caja).
import type { Permissions } from "@/lib/permissions";

export type ReportCategory = "finanzas" | "operacion" | "personal";

export type ReportIcon = "sales" | "concepts" | "closings" | "audit" | "appointments" | "professionals" | "patients" | "receivables" | "activity";

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  category: ReportCategory;
  icon: ReportIcon;
  /** Filtros adicionales al periodo. */
  filters: { area: boolean; professional: boolean };
};

export const REPORTS = [
  {
    key: "ventas",
    title: "Ventas",
    description: "Vendido, ticket promedio, descuentos y cancelaciones; por día, forma de pago y cajero.",
    category: "finanzas",
    icon: "sales",
    filters: { area: false, professional: false },
  },
  {
    key: "ingresos-por-concepto",
    title: "Ingresos por concepto",
    description: "Qué servicios y conceptos se cobran más: cantidad, importe y participación en el total.",
    category: "finanzas",
    icon: "concepts",
    filters: { area: false, professional: false },
  },
  {
    key: "cortes-de-caja",
    title: "Cortes de caja",
    description: "Turnos del periodo con efectivo esperado contra contado, faltantes, sobrantes y salidas de efectivo.",
    category: "finanzas",
    icon: "closings",
    filters: { area: false, professional: false },
  },
  {
    key: "cancelaciones-y-descuentos",
    title: "Cancelaciones y descuentos",
    description: "Auditoría de cobros cancelados (motivo y quién) y descuentos otorgados por cajero.",
    category: "finanzas",
    icon: "audit",
    filters: { area: false, professional: false },
  },
  {
    key: "citas",
    title: "Citas",
    description: "Agendadas, atendidas, inasistencias y cancelaciones; por día, servicio y horas de mayor demanda.",
    category: "operacion",
    icon: "appointments",
    filters: { area: true, professional: true },
  },
  {
    key: "profesionales",
    title: "Desempeño por profesional",
    description: "Horas disponibles contra reservadas (ocupación), asistencia y pacientes atendidos de cada profesional.",
    category: "operacion",
    icon: "professionals",
    filters: { area: true, professional: false },
  },
  {
    key: "pacientes",
    title: "Pacientes",
    description: "Pacientes nuevos, de primera vez y recurrentes; los más frecuentes y quiénes no asistieron.",
    category: "operacion",
    icon: "patients",
    filters: { area: true, professional: true },
  },
  {
    key: "citas-por-cobrar",
    title: "Citas atendidas sin cobro",
    description: "Citas marcadas como atendidas que no tienen un cobro vigente, con su precio de lista.",
    category: "operacion",
    icon: "receivables",
    filters: { area: true, professional: true },
  },
  {
    key: "mi-actividad",
    title: "Mi actividad",
    description: "Tus citas, asistencia, pacientes atendidos y la ocupación de tu horario.",
    category: "personal",
    icon: "activity",
    filters: { area: false, professional: false },
  },
] as const satisfies readonly ReportDef[];

export type ReportKey = (typeof REPORTS)[number]["key"];

export const CATEGORIES: { key: ReportCategory; label: string; description: string }[] = [
  { key: "finanzas", label: "Finanzas", description: "Para Administración: dinero que entra, sale y se audita." },
  { key: "operacion", label: "Operación", description: "Para Administración: agenda, profesionales y pacientes." },
  { key: "personal", label: "Mi consulta", description: "Para quien atiende consultas: su propia actividad." },
];

export type ReportAccess = { can: Pick<Permissions, "financialReports" | "operationalReports">; ownProfessionalId: string | null };

export function canViewReport(def: Pick<ReportDef, "category">, access: ReportAccess): boolean {
  switch (def.category) {
    case "finanzas":
      return access.can.financialReports;
    case "operacion":
      return access.can.operationalReports;
    case "personal":
      return Boolean(access.ownProfessionalId);
  }
}

export function reportsFor(access: ReportAccess): ReportDef[] {
  return REPORTS.filter((r) => canViewReport(r, access));
}

export function findReport(key: string): (typeof REPORTS)[number] | null {
  return REPORTS.find((r) => r.key === key) ?? null;
}
