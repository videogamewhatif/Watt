// Modo de prueba: recorrer la interfaz con datos FICTICIOS en memoria, sin Supabase.
// Activo en `npm run dev`. En producción solo si se define WATTALIS_DEMO=1.
// Nunca toca la base de datos real: usa un almacén aparte que se pierde al reiniciar.

export const DEMO_COOKIE = "wattalis_demo";

export type DemoPersona = { id: string; key: string; label: string; name: string; email: string };

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    key: "admin",
    label: "Administración · Clínica Arboleda",
    name: "Laura Gómez",
    email: "admin@clinica-arboleda.test",
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    key: "recepcion",
    label: "Recepción · Clínica Arboleda (y admin de Veterinaria Patitas)",
    name: "Mario Pérez",
    email: "recepcion@clinica-arboleda.test",
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    key: "profesional",
    label: "Profesional · Dra. Ana Ruiz",
    name: "Ana Ruiz",
    email: "ana.ruiz@clinica-arboleda.test",
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    key: "independiente",
    label: "Consultorio independiente · Dr. Luis Herrera",
    name: "Luis Herrera",
    email: "luis.herrera@consultorio.test",
  },
];

export function isDemoEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.WATTALIS_DEMO === "1";
}

export function demoPersona(id: string | undefined | null): DemoPersona | null {
  if (!id || !isDemoEnabled()) return null;
  return DEMO_PERSONAS.find((p) => p.id === id) ?? null;
}
