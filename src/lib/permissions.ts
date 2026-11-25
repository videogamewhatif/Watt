import type { MemberRole } from "@/lib/database.types";

/**
 * Qué muestra la interfaz a cada rol. Es solo presentación: la base de datos
 * vuelve a comprobar cada operación con RLS.
 */
export function permissionsFor(role: MemberRole) {
  return {
    /** Configurar el espacio, miembros, roles e invitaciones. */
    manageWorkspace: role === "admin",
    /** Crear y editar profesionales, servicios, horarios y bloqueos. */
    manageCatalog: role === "admin",
    /** Consultar el directorio de profesionales y servicios. */
    viewCatalog: role === "admin" || role === "reception",
    /** Ver y gestionar las citas de todos los profesionales del espacio. */
    allAppointments: role === "admin" || role === "reception",
    /** Abrir y cerrar turnos de caja, cobrar y registrar entradas y salidas de efectivo. */
    operateCash: role === "admin" || role === "reception",
    /** Cancelar cobros ya registrados (siempre con motivo). */
    voidCharges: role === "admin",
    /** Reportes de finanzas: ventas, ingresos, cortes de caja y auditoría de cobros. */
    financialReports: role === "admin",
    /** Reportes de operación: citas, profesionales, pacientes y citas por cobrar. */
    operationalReports: role === "admin",
    /**
     * Suscripción y facturación del espacio (plan, cobros, métodos de pago).
     * Independiente de lo que incluye el plan; el servicio de facturación lo
     * vuelve a verificar en el servidor (ver features/billing/authz.ts).
     */
    manageBilling: role === "admin",
  };
}

export type Permissions = ReturnType<typeof permissionsFor>;

export type NavLink = {
  href: string;
  label: string;
  /** Solo activo en la ruta exacta (p. ej. «General» dentro de Configuración). */
  exact?: boolean;
  /** Otras rutas que también marcan este enlace como activo. */
  alsoActive?: string[];
};
/**
 * Bloque de la barra lateral:
 * - general: Inicio, arriba de todo.
 * - area: lo que cambia con el área de atención elegida (Hospital, Dentista, …).
 * - clinic: lo que es igual para toda la clínica, sin importar el área.
 * - settings: fijo abajo.
 */
export type NavSection = "general" | "area" | "clinic" | "settings";
export type NavItem = NavLink & {
  icon: "home" | "calendar" | "schedule" | "users" | "contacts" | "cash" | "services" | "reports" | "settings";
  section: NavSection;
  children?: NavLink[];
};

/** Submenú de Ventas. */
export const SALES_NAV: NavLink[] = [
  { href: "/ventas/caja", label: "Caja" },
  { href: "/ventas/mis-ventas", label: "Mis ventas" },
  { href: "/ventas/precorte", label: "Precorte" },
];

/** Submenú de Configuración para Administración. */
export const SETTINGS_NAV: NavLink[] = [
  { href: "/configuracion", label: "General", exact: true },
  { href: "/configuracion/suscripcion", label: "Suscripción y facturación", alsoActive: ["/configuracion/facturacion"] },
];

/**
 * `ownSchedule`: la cuenta tiene perfil profesional en el espacio, así que ve
 * «Mi horario» (su horario semanal y bloqueos) justo debajo de Agenda.
 */
export function navigationFor(role: MemberRole, { ownSchedule = false }: { ownSchedule?: boolean } = {}): NavItem[] {
  const can = permissionsFor(role);
  const items: NavItem[] = [
    { href: "/inicio", label: "Inicio", icon: "home", section: "general" },
    { href: "/agenda", label: "Agenda", icon: "calendar", section: "area" },
  ];
  // Es personal: no cambia con el área elegida.
  if (ownSchedule) items.push({ href: "/mi-horario", label: "Mi horario", icon: "schedule", section: "general" });
  if (can.viewCatalog) items.push({ href: "/profesionales", label: "Profesionales", icon: "users", section: "area" });
  items.push({ href: "/pacientes", label: can.allAppointments ? "Pacientes" : "Mis pacientes", icon: "contacts", section: "clinic" });
  if (can.operateCash) items.push({ href: "/ventas", label: "Ventas", icon: "cash", section: "clinic", children: SALES_NAV });
  if (can.viewCatalog) items.push({ href: "/servicios", label: "Servicios", icon: "services", section: "clinic" });
  // Quien atiende consultas siempre tiene al menos su propio reporte de actividad.
  if (can.financialReports || can.operationalReports || ownSchedule) items.push({ href: "/reportes", label: "Reportes", icon: "reports", section: "clinic" });
  items.push({
    href: "/configuracion",
    label: "Configuración",
    icon: "settings",
    section: "settings",
    children: can.manageBilling ? SETTINGS_NAV : undefined,
  });
  return items;
}
