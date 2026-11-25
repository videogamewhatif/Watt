import { describe, expect, it } from "vitest";
import { navigationFor, permissionsFor } from "@/lib/permissions";

describe("navegación por rol", () => {
  it("muestra solo los módulos permitidos", () => {
    const labels = (role: Parameters<typeof navigationFor>[0]) => navigationFor(role).map((i) => i.label);
    expect(labels("admin")).toEqual(["Inicio", "Agenda", "Profesionales", "Pacientes", "Ventas", "Servicios", "Reportes", "Configuración"]);
    expect(labels("reception")).toEqual(["Inicio", "Agenda", "Profesionales", "Pacientes", "Ventas", "Servicios", "Configuración"]);
    expect(labels("professional")).toEqual(["Inicio", "Agenda", "Mis pacientes", "Configuración"]);
  });

  it("quien tiene perfil profesional ve «Mi horario» debajo de Agenda", () => {
    const labels = navigationFor("professional", { ownSchedule: true }).map((i) => i.label);
    expect(labels).toEqual(["Inicio", "Agenda", "Mi horario", "Mis pacientes", "Reportes", "Configuración"]);
    expect(navigationFor("admin", { ownSchedule: true }).find((i) => i.href === "/mi-horario")?.section).toBe("general");
  });

  it("separa lo que cambia por área de lo que es de toda la clínica", () => {
    const sections = Object.fromEntries(navigationFor("admin").map((i) => [i.label, i.section]));
    expect(sections).toEqual({
      Inicio: "general",
      Agenda: "area",
      Profesionales: "area",
      Pacientes: "clinic",
      Ventas: "clinic",
      Servicios: "clinic",
      Reportes: "clinic",
      Configuración: "settings",
    });
  });

  it("ventas agrupa caja, mis ventas y precorte", () => {
    const sales = navigationFor("reception").find((i) => i.href === "/ventas");
    expect(sales?.children?.map((c) => c.label)).toEqual(["Caja", "Mis ventas", "Precorte"]);
  });

  it("solo administración gestiona el espacio y el catálogo", () => {
    expect(permissionsFor("admin")).toMatchObject({ manageWorkspace: true, manageCatalog: true, allAppointments: true });
    expect(permissionsFor("reception")).toMatchObject({ manageWorkspace: false, manageCatalog: false, viewCatalog: true, allAppointments: true });
    expect(permissionsFor("professional")).toMatchObject({ manageWorkspace: false, manageCatalog: false, viewCatalog: false, allAppointments: false });
  });

  it("la caja la operan administración y recepción; solo administración cancela cobros", () => {
    expect(permissionsFor("admin")).toMatchObject({ operateCash: true, voidCharges: true });
    expect(permissionsFor("reception")).toMatchObject({ operateCash: true, voidCharges: false });
    expect(permissionsFor("professional")).toMatchObject({ operateCash: false, voidCharges: false });
  });

  it("reportes de finanzas y de operación: solo administración", () => {
    expect(permissionsFor("admin")).toMatchObject({ financialReports: true, operationalReports: true });
    expect(permissionsFor("reception")).toMatchObject({ financialReports: false, operationalReports: false });
    expect(permissionsFor("professional")).toMatchObject({ financialReports: false, operationalReports: false });
    // Profesional sin perfil vinculado no tiene ningún reporte: no ve la opción.
    expect(navigationFor("professional").some((i) => i.href === "/reportes")).toBe(false);
  });
});
