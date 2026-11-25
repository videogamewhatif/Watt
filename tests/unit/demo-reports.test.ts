// Los reportes leen con la sesión de cada persona: en el modo de prueba se
// aplican los mismos permisos que RLS, así que aquí se prueba de punta a punta
// (lectura paginada → cálculo) y que ningún rol obtenga datos ajenos.
import { beforeEach, describe, expect, it } from "vitest";
import type { MemberRole } from "@/lib/database.types";
import { parseReportFilters } from "@/features/reports/params";
import { loadReport } from "@/features/reports/queries";
import type { LoadedReport } from "@/features/reports/model";
import { createDemoClient } from "@/lib/demo/client";
import { getDemoStore, resetDemoStore } from "@/lib/demo/data";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { permissionsFor } from "@/lib/permissions";
import type { AppContext } from "@/lib/session";
import { addDays, todayIn } from "@/lib/tz";

const TZ = "America/Mexico_City";
const CLINIC = "b0000000-0000-4000-8000-000000000001";
const P_RUIZ = "c0000000-0000-4000-8000-000000000001";
const P_SALAS = "c0000000-0000-4000-8000-000000000002";
const [ADMIN, RECEPTION, PROFESSIONAL] = DEMO_PERSONAS;

function ctxFor(persona: (typeof DEMO_PERSONAS)[number], role: MemberRole, ownProfessionalId: string | null = null, can = permissionsFor(role)): AppContext {
  const workspace = { id: CLINIC, membershipId: "m", name: "Clínica Arboleda (demo)", kind: "clinic" as const, timezone: TZ, slotInterval: 15, role };
  return { supabase: createDemoClient(persona.id), user: { id: persona.id, email: persona.email, fullName: persona.name }, workspaces: [workspace], workspace, role, can, ownProfessionalId };
}

const today = todayIn(TZ);
const filters = (extra: Record<string, string> = {}) => parseReportFilters({ desde: addDays(today, -10), hasta: addDays(today, 10), ...extra }, today);
const kpi = (r: LoadedReport | null, label: string) => r?.kpis.find((k) => k.label === label)?.value;
const inRange = (iso: string) => iso >= new Date(Date.now() - 12 * 86_400_000).toISOString() && iso <= new Date(Date.now() + 12 * 86_400_000).toISOString();

beforeEach(() => resetDemoStore());

describe("reportes en modo de prueba", () => {
  it("ventas y cortes: el turno de ayer con su cancelación y su faltante", async () => {
    const admin = ctxFor(ADMIN, "admin");
    const sales = await loadReport(admin, "ventas", filters());
    expect(sales?.error).toBe(false);
    expect(kpi(sales, "Vendido")).toBe(450 + 700);
    expect(kpi(sales, "Cancelados")).toBe(1);

    const closings = await loadReport(admin, "cortes-de-caja", filters());
    expect(kpi(closings, "Turnos cerrados")).toBe(1);
    expect(kpi(closings, "Faltantes")).toBe(10);
    expect(kpi(closings, "Salidas de efectivo")).toBe(120);

    const audit = await loadReport(admin, "cancelaciones-y-descuentos", filters());
    expect(audit?.tables.find((t) => t.id === "cancelados")?.rows[0].values).toMatchObject({ motivo: "Cobro duplicado", cancelo: "Laura Gómez" });
  });

  it("cada rol ve solo los reportes que le corresponden", async () => {
    const reception = ctxFor(RECEPTION, "reception");
    expect(await loadReport(reception, "ventas", filters())).toBeNull();
    expect(await loadReport(reception, "citas", filters())).toBeNull();
    expect(await loadReport(reception, "citas-por-cobrar", filters())).toBeNull();
    expect(await loadReport(reception, "mi-actividad", filters())).toBeNull();

    const professional = ctxFor(PROFESSIONAL, "professional", P_RUIZ);
    expect(await loadReport(professional, "citas", filters())).toBeNull();
    expect(await loadReport(professional, "pacientes", filters())).toBeNull();
    expect(await loadReport(professional, "no-existe", filters())).toBeNull();
  });

  it("aunque la interfaz fallara, la base no entrega la caja al rol Profesional", async () => {
    const forged = ctxFor(PROFESSIONAL, "professional", P_RUIZ, permissionsFor("admin"));
    const sales = await loadReport(forged, "ventas", filters());
    expect(kpi(sales, "Vendido")).toBe(0);
    expect(sales?.tables.every((t) => t.rows.length === 0)).toBe(true);
  });

  it("«Mi actividad» solo cuenta las citas del propio profesional", async () => {
    const mine = await loadReport(ctxFor(PROFESSIONAL, "professional", P_RUIZ), "mi-actividad", filters());
    const expected = getDemoStore().appointments.filter((a) => a.professional_id === P_RUIZ && a.status !== "cancelled" && inRange(a.starts_at)).length;
    expect(expected).toBeGreaterThan(0);
    expect(kpi(mine, "Agendadas")).toBe(expected);
    expect(mine?.kpis.some((k) => k.format === "money")).toBe(false);
  });

  it("filtra por área y muestra ingresos por profesional a Administración", async () => {
    const admin = ctxFor(ADMIN, "admin");
    const all = await loadReport(admin, "profesionales", filters());
    expect(all?.tables[0].rows.map((r) => r.href)).toEqual([`/profesionales/${P_SALAS}`, `/profesionales/${P_RUIZ}`]);
    expect(all?.tables[0].columns.map((c) => c.key)).toContain("ingresos");

    const dental = await loadReport(admin, "profesionales", filters({ area: "dentista" }));
    expect(dental?.tables[0].rows.map((r) => r.href)).toEqual([`/profesionales/${P_SALAS}`]);
  });

  it("las citas atendidas sin cobro ligado aparecen como pendientes", async () => {
    const report = await loadReport(ctxFor(ADMIN, "admin"), "citas-por-cobrar", filters());
    const attended = getDemoStore().appointments.filter((a) => a.organization_id === CLINIC && a.status === "attended" && inRange(a.starts_at)).length;
    expect(kpi(report, "Citas sin cobro")).toBe(attended);
  });
});

describe("filtros del cliente de prueba", () => {
  it("compara instantes por su valor y pagina con range", async () => {
    const client = createDemoClient(ADMIN.id);
    const { data: all } = await client.from("services").select("id").eq("organization_id", CLINIC).order("id");
    const { data: page } = await client.from("services").select("id").eq("organization_id", CLINIC).order("id").range(1, 2);
    expect(page).toEqual(all!.slice(1, 3));

    const session = getDemoStore().cash_sessions[0];
    const asOffset = session.opened_at.replace("Z", "+00:00").replace(/\.\d{3}/, "");
    const { data: hit } = await client.from("cash_sessions").select("id").gte("opened_at", asOffset).lt("opened_at", session.closed_at);
    expect(hit).toHaveLength(1);
    const { data: miss } = await client.from("cash_sessions").select("id").gt("opened_at", asOffset);
    expect(miss).toHaveLength(0);
  });
});
