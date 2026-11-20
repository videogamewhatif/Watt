import { describe, expect, it } from "vitest";
import { navigationFor, permissionsFor } from "@/lib/permissions";

describe("navegación por rol", () => {
  it("muestra solo los módulos permitidos", () => {
    const labels = (role: Parameters<typeof navigationFor>[0]) => navigationFor(role).map((i) => i.label);
    expect(labels("admin")).toEqual(["Inicio", "Agenda", "Profesionales", "Pacientes", "Servicios", "Configuración"]);
    expect(labels("reception")).toEqual(["Inicio", "Agenda", "Profesionales", "Pacientes", "Servicios", "Configuración"]);
    expect(labels("professional")).toEqual(["Inicio", "Agenda", "Mis pacientes", "Configuración"]);
  });

  it("solo administración gestiona el espacio y el catálogo", () => {
    expect(permissionsFor("admin")).toMatchObject({ manageWorkspace: true, manageCatalog: true, allAppointments: true });
    expect(permissionsFor("reception")).toMatchObject({ manageWorkspace: false, manageCatalog: false, viewCatalog: true, allAppointments: true });
    expect(permissionsFor("professional")).toMatchObject({ manageWorkspace: false, manageCatalog: false, viewCatalog: false, allAppointments: false });
  });
});
