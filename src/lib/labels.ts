import type { AppointmentStatus, MemberRole, OrganizationKind, TimeOffKind } from "@/lib/database.types";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  attended: "Atendida",
  cancelled: "Cancelada",
  no_show: "No asistió",
};

export const STATUS_ORDER: AppointmentStatus[] = ["pending", "confirmed", "attended", "no_show", "cancelled"];

export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "Administrador",
  reception: "Recepción",
  professional: "Profesional",
};

export const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  admin: "Gestiona el espacio, profesionales, servicios, horarios, pacientes, citas y miembros.",
  reception: "Registra pacientes y gestiona las citas de todo el espacio. No administra miembros ni permisos.",
  professional: "Consulta su agenda y gestiona sus propias citas y pacientes vinculados.",
};

export const KIND_LABEL: Record<OrganizationKind, string> = {
  hospital: "Hospital",
  clinic: "Clínica",
  independent: "Consultorio independiente",
};

export const TIME_OFF_LABEL: Record<TimeOffKind, string> = {
  vacation: "Vacaciones",
  meal: "Comida",
  absence: "Ausencia",
  other: "Otro",
};

export const WEEKDAYS: { iso: number; label: string; short: string }[] = [
  { iso: 1, label: "Lunes", short: "Lun" },
  { iso: 2, label: "Martes", short: "Mar" },
  { iso: 3, label: "Miércoles", short: "Mié" },
  { iso: 4, label: "Jueves", short: "Jue" },
  { iso: 5, label: "Viernes", short: "Vie" },
  { iso: 6, label: "Sábado", short: "Sáb" },
  { iso: 7, label: "Domingo", short: "Dom" },
];

export const PROFESSIONAL_COLORS = ["#0f766e", "#1d4ed8", "#7c3aed", "#b45309", "#be185d", "#15803d", "#0369a1", "#9f1239"];
