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
  };
}

export type Permissions = ReturnType<typeof permissionsFor>;

export type NavItem = { href: string; label: string; icon: "home" | "calendar" | "users" | "contacts" | "services" | "settings" };

export function navigationFor(role: MemberRole): NavItem[] {
  const can = permissionsFor(role);
  const items: NavItem[] = [
    { href: "/inicio", label: "Inicio", icon: "home" },
    { href: "/agenda", label: "Agenda", icon: "calendar" },
  ];
  if (can.viewCatalog) items.push({ href: "/profesionales", label: "Profesionales", icon: "users" });
  items.push({ href: "/pacientes", label: can.allAppointments ? "Pacientes" : "Mis pacientes", icon: "contacts" });
  if (can.viewCatalog) items.push({ href: "/servicios", label: "Servicios", icon: "services" });
  items.push({ href: "/configuracion", label: "Configuración", icon: "settings" });
  return items;
}
