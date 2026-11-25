// Reportes: filtros de periodo, cálculos y exportación. Corre con TZ=Asia/Tokyo:
// todo debe calcularse en la zona del espacio, nunca en la del servidor.
import { describe, expect, it } from "vitest";
import { canViewReport, REPORTS, reportsFor } from "@/features/reports/catalog";
import {
  type AppointmentIn,
  appointmentsReport,
  auditReport,
  availableMinutes,
  cashClosingsReport,
  type ChargeIn,
  conceptsReport,
  occupancyFor,
  patientsReport,
  type PaymentIn,
  professionalsReport,
  receivablesReport,
  salesReport,
} from "@/features/reports/compute";
import { csvValue, formatCell, tableToCsv } from "@/features/reports/format";
import type { ReportResult } from "@/features/reports/model";
import { bucketsBetween, effectiveFilters, granularityFor, parseReportFilters, periodLabel, presetRange } from "@/features/reports/params";
import { permissionsFor } from "@/lib/permissions";

const TZ = "America/Mexico_City"; // UTC−6 todo el año
const NOV = { from: "2026-11-01", to: "2026-11-21", timezone: TZ };
const table = (r: ReportResult, id: string) => r.tables.find((t) => t.id === id)!;
const kpi = (r: ReportResult, label: string) => r.kpis.find((k) => k.label === label)?.value;

// ---------------------------------------------------------------------------
describe("periodos de los reportes", () => {
  const today = "2026-11-21"; // sábado

  it("resuelve los periodos preestablecidos con la fecha del espacio", () => {
    expect(presetRange("hoy", today)).toEqual({ from: today, to: today });
    expect(presetRange("ayer", today)).toEqual({ from: "2026-11-20", to: "2026-11-20" });
    expect(presetRange("semana", today)).toEqual({ from: "2026-11-16", to: today });
    expect(presetRange("semana-pasada", today)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(presetRange("mes", today)).toEqual({ from: "2026-11-01", to: today });
    expect(presetRange("mes-pasado", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("30-dias", today)).toEqual({ from: "2026-10-23", to: today });
    expect(presetRange("anio", today)).toEqual({ from: "2026-01-01", to: today });
    expect(presetRange("mes-pasado", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("lee la URL: por omisión el mes en curso; corrige rangos invertidos y recorta a un año", () => {
    expect(parseReportFilters({}, today)).toMatchObject({ from: "2026-11-01", to: today, preset: "mes", area: null, professionalId: null });
    expect(parseReportFilters({ periodo: "ayer", desde: "2026-01-01" }, today)).toMatchObject({ from: "2026-11-20", to: "2026-11-20", preset: "ayer" });
    expect(parseReportFilters({ desde: "2026-11-10", hasta: "2026-11-02" }, today)).toMatchObject({ from: "2026-11-02", to: "2026-11-10", preset: null });
    expect(parseReportFilters({ desde: "2024-01-01", hasta: "2026-11-21" }, today)).toMatchObject({ from: "2025-11-21", to: "2026-11-21" });
    expect(parseReportFilters({ desde: "2026-11-16", hasta: today }, today).preset).toBe("semana");
    expect(parseReportFilters({ desde: "2026-02-30", area: "magia", profesional: "x" }, today)).toMatchObject({ preset: "mes", area: null, professionalId: null });
    const id = "c0000000-0000-4000-8000-000000000001";
    expect(parseReportFilters({ area: "dentista", profesional: id }, today)).toMatchObject({ area: "dentista", professionalId: id });
  });

  it("ignora filtros que el reporte no usa o áreas que el espacio no tiene", () => {
    const f = parseReportFilters({ area: "dentista", profesional: "c0000000-0000-4000-8000-000000000001" }, today);
    expect(effectiveFilters(f, { filters: { area: true, professional: false } }, ["medico", "dentista"])).toMatchObject({ area: "dentista", professionalId: null });
    expect(effectiveFilters(f, { filters: { area: true, professional: true } }, ["medico"])).toMatchObject({ area: null });
  });

  it("agrupa por día hasta un mes, por semana hasta un trimestre y luego por mes", () => {
    expect(granularityFor("2026-11-01", "2026-12-01")).toBe("day");
    expect(granularityFor("2026-11-01", "2026-12-02")).toBe("week");
    expect(granularityFor("2026-08-03", "2026-11-02")).toBe("week");
    expect(granularityFor("2026-08-01", "2026-11-02")).toBe("month");
    expect(bucketsBetween("2026-11-04", "2026-11-17", "week")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(bucketsBetween("2025-11-15", "2026-02-01", "month")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("escribe el periodo de forma legible", () => {
    expect(periodLabel("2026-11-21", "2026-11-21")).toBe("21 de noviembre de 2026");
    expect(periodLabel("2026-11-01", "2026-11-21")).toBe("1 – 21 de noviembre de 2026");
    expect(periodLabel("2026-10-23", "2026-11-21")).toBe("23 de octubre – 21 de noviembre de 2026");
    expect(periodLabel("2025-12-15", "2026-01-10")).toBe("15 de diciembre de 2025 – 10 de enero de 2026");
  });
});

// ---------------------------------------------------------------------------
describe("acceso a los reportes", () => {
  const access = (role: "admin" | "reception" | "professional", ownProfessionalId: string | null = null) => ({ can: permissionsFor(role), ownProfessionalId });

  it("finanzas y operación solo Administración; Recepción ninguno; «Mi actividad» a quien atiende", () => {
    expect(reportsFor(access("admin")).map((r) => r.category)).not.toContain("personal");
    expect(new Set(reportsFor(access("admin")).map((r) => r.category))).toEqual(new Set(["finanzas", "operacion"]));
    expect(reportsFor(access("reception"))).toEqual([]);
    expect(reportsFor(access("professional", "p1")).map((r) => r.key)).toEqual(["mi-actividad"]);
    expect(reportsFor(access("professional"))).toEqual([]);
    expect(reportsFor(access("admin", "p1")).map((r) => r.key)).toContain("mi-actividad");
  });

  it("cada reporte pertenece a una categoría con regla de acceso", () => {
    for (const r of REPORTS) expect(typeof canViewReport(r, access("admin"))).toBe("boolean");
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length);
  });
});

// ---------------------------------------------------------------------------
// Datos de ejemplo: noviembre de 2026 en Ciudad de México.
const charge = (over: Partial<ChargeIn> & Pick<ChargeIn, "id" | "created_at" | "total">): ChargeIn => ({
  folio: 1,
  status: "paid",
  created_by: "u1",
  contact_id: null,
  appointment_id: null,
  session_id: "s1",
  subtotal: over.total,
  discount: 0,
  voided_by: null,
  voided_at: null,
  void_reason: null,
  ...over,
});
const CHARGES: ChargeIn[] = [
  charge({ id: "c1", folio: 1, created_at: "2026-11-03T16:00:00.000Z", total: 450, contact_id: "k1" }),
  // 23:30 del 3 de noviembre en la zona del espacio (ya es día 4 en UTC).
  charge({ id: "c2", folio: 2, created_at: "2026-11-04T05:30:00.000Z", subtotal: 1000, discount: 100, total: 900, created_by: "u2", contact_id: "k2" }),
  charge({ id: "c3", folio: 3, created_at: "2026-11-04T18:00:00.000Z", total: 300, status: "voided", voided_by: "u2", voided_at: "2026-11-04T18:30:00.000Z", void_reason: "Duplicado" }),
];
const PAYMENTS: PaymentIn[] = [
  { charge_id: "c1", session_id: "s1", method: "cash", amount: 450 },
  { charge_id: "c2", session_id: "s1", method: "card", amount: 600 },
  { charge_id: "c2", session_id: "s1", method: "cash", amount: 300 },
  { charge_id: "c3", session_id: "s1", method: "transfer", amount: 300 },
];
const NAMES = new Map([
  ["u1", "Mario"],
  ["u2", "Laura"],
]);

describe("reporte de ventas", () => {
  const r = salesReport({ period: NOV, charges: CHARGES, payments: PAYMENTS, names: NAMES });

  it("suma solo cobros vigentes y cuenta las cancelaciones aparte", () => {
    expect(kpi(r, "Vendido")).toBe(1350);
    expect(kpi(r, "Ticket promedio")).toBe(675);
    expect(kpi(r, "Descuentos")).toBe(100);
    expect(kpi(r, "Cancelados")).toBe(1);
  });

  it("agrupa por día local del espacio y por forma de pago", () => {
    expect(table(r, "por-periodo").rows).toEqual([
      { values: { periodo: "2026-11-03", cobros: 2, subtotal: 1450, descuentos: 100, total: 1350, efectivo: 750, tarjeta: 600, transferencia: 0 } },
    ]);
    expect(table(r, "formas-de-pago").rows.map((x) => [x.values.forma, x.values.pagos, x.values.importe])).toEqual([
      ["Efectivo", 2, 750],
      ["Tarjeta", 1, 600],
      ["Transferencia", 0, 0],
    ]);
    const chart = r.charts.find((c) => c.id === "vendido");
    expect(chart?.kind === "columns" && chart.points).toHaveLength(21);
  });

  it("resume por cajero, incluidas sus cancelaciones", () => {
    expect(table(r, "por-cajero").rows.map((x) => x.values)).toEqual([
      { cajero: "Laura", cobros: 1, vendido: 900, ticket: 900, cancelados: 0 },
      { cajero: "Mario", cobros: 1, vendido: 450, ticket: 450, cancelados: 1 },
    ]);
  });
});

describe("ingresos por concepto", () => {
  it("agrupa servicios por catálogo y conceptos libres por descripción, sin los cancelados", () => {
    const r = conceptsReport({
      charges: CHARGES,
      items: [
        { charge_id: "c1", service_id: "s1", description: "Consulta (precio anterior)", quantity: 1, amount: 450 },
        { charge_id: "c2", service_id: "s1", description: "Consulta", quantity: 1, amount: 450 },
        { charge_id: "c2", service_id: null, description: "Material ", quantity: 2, amount: 550 },
        { charge_id: "c3", service_id: null, description: "Material", quantity: 1, amount: 300 },
      ],
      serviceNames: new Map([["s1", "Consulta general"]]),
    });
    expect(table(r, "conceptos").rows.map((x) => [x.values.concepto, x.values.tipo, x.values.cantidad, x.values.importe])).toEqual([
      ["Consulta general", "Servicio", 2, 900],
      ["Material", "Concepto libre", 2, 550],
    ]);
    expect(kpi(r, "Importe bruto")).toBe(1450);
    expect(kpi(r, "Neto")).toBe(1350);
  });
});

describe("cortes de caja", () => {
  it("usa el esperado del corte, calcula el del turno abierto y separa faltantes y sobrantes", () => {
    const r = cashClosingsReport({
      period: NOV,
      sessions: [
        { id: "s1", opened_at: "2026-11-03T14:00:00.000Z", opened_by: "u1", closed_at: "2026-11-04T01:00:00.000Z", closed_by: "u1", opening_amount: 500, counted_cash: 1190, expected_cash: 1200, difference: -10 },
        { id: "s2", opened_at: "2026-11-05T14:00:00.000Z", opened_by: "u2", closed_at: null, closed_by: null, opening_amount: 200, counted_cash: null, expected_cash: null, difference: null },
      ],
      charges: CHARGES,
      payments: PAYMENTS,
      movements: [{ session_id: "s1", kind: "out", amount: 50, concept: "Papelería", created_at: "2026-11-03T20:00:00.000Z", created_by: "u1" }],
      names: NAMES,
    });
    const [closed, open] = table(r, "turnos").rows;
    expect(closed).toMatchObject({ href: "/ventas/turnos/s1", values: { apertura: "2026-11-03T08:00", efectivo: 750, tarjeta: 600, transferencia: 0, salidas: 50, esperado: 1200, diferencia: -10 } });
    expect(open).toMatchObject({ muted: true, values: { estado: "Abierto", esperado: 200, diferencia: null } });
    expect(kpi(r, "Turnos cerrados")).toBe(1);
    expect(kpi(r, "Faltantes")).toBe(10);
    expect(kpi(r, "Diferencia neta")).toBe(-10);
    expect(table(r, "movimientos").rows[0].values).toMatchObject({ tipo: "Salida", importe: -50, registro: "Mario" });
  });
});

describe("cancelaciones y descuentos", () => {
  it("lista quién canceló y por qué, y el porcentaje de descuento", () => {
    const r = auditReport({ period: NOV, charges: CHARGES, names: NAMES, contactNames: new Map([["k2", "José"]]) });
    expect(table(r, "cancelados").rows[0].values).toMatchObject({ folio: 3, paciente: "Venta de mostrador", total: 300, cobro: "Mario", cancelo: "Laura", motivo: "Duplicado" });
    expect(table(r, "descuentos").rows[0].values).toMatchObject({ folio: 2, paciente: "José", descuento: 100, porcentaje: 0.1 });
    expect(kpi(r, "Tasa de cancelación")).toBeCloseTo(1 / 3);
    expect(kpi(r, "Descuento promedio")).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
const appt = (id: string, status: AppointmentIn["status"], startsUtc: string, over: Partial<AppointmentIn> = {}): AppointmentIn => ({
  id,
  professional_id: "p1",
  service_id: "s1",
  contact_id: "k1",
  status,
  starts_at: startsUtc,
  ends_at: new Date(Date.parse(startsUtc) + 30 * 60_000).toISOString(),
  ...over,
});
const APPTS = [
  appt("a1", "attended", "2026-11-03T16:00:00.000Z"), // martes 10:00
  appt("a2", "no_show", "2026-11-03T17:00:00.000Z", { contact_id: "k3" }), // martes 11:00
  appt("a3", "cancelled", "2026-11-04T16:00:00.000Z"),
  appt("a4", "pending", "2026-11-05T16:00:00.000Z"),
  appt("a5", "confirmed", "2026-11-06T16:00:00.000Z"),
];

describe("reporte de citas", () => {
  const r = appointmentsReport({ period: NOV, appointments: APPTS, serviceNames: new Map([["s1", "Consulta"]]), now: new Date("2026-11-06T00:00:00Z") });

  it("cuenta estados, asistencia y citas pasadas sin marcar", () => {
    expect(kpi(r, "Agendadas")).toBe(4);
    expect(kpi(r, "Canceladas")).toBe(1);
    expect(kpi(r, "Asistencia")).toBe(0.5);
    expect(kpi(r, "Pasadas sin marcar")).toBe(1);
  });

  it("ubica la demanda en el día y la hora locales", () => {
    const heat = r.charts.find((c) => c.kind === "heatmap");
    expect(heat?.kind).toBe("heatmap");
    if (heat?.kind !== "heatmap") return;
    expect(heat.colLabels).toEqual(["10:00", "11:00"]);
    expect(heat.rowLabels[1]).toBe("Mar");
    expect(heat.values[1]).toEqual([1, 1]); // martes: a1 a las 10 y a2 a las 11
    expect(heat.values[3]).toEqual([1, 0]); // jueves: a4
  });

  it("resume por servicio y por día de la semana", () => {
    expect(table(r, "por-servicio").rows[0].values).toMatchObject({ servicio: "Consulta", agendadas: 4, atendidas: 1, no_asistio: 1, canceladas: 1, horas: 2 });
    expect(table(r, "por-dia-de-la-semana").rows.map((x) => x.values.dia)).toEqual(["Martes", "Miércoles", "Jueves", "Viernes"]);
  });
});

describe("ocupación", () => {
  const day = { from: "2026-11-03", to: "2026-11-03", timezone: TZ };
  const rules = [{ professional_id: "p1", weekday: 2, start_time: "09:00:00", end_time: "13:00:00" }];
  // Las citas ya llegan filtradas por periodo: las del martes 3 más una cancelada.
  const SAME_DAY = [...APPTS.slice(0, 2), appt("a8", "cancelled", "2026-11-03T18:00:00.000Z")];

  it("descuenta bloqueos sin restarlos dos veces cuando se enciman", () => {
    const blocks = [
      { professional_id: "p1", starts_at: "2026-11-03T17:00:00.000Z", ends_at: "2026-11-03T17:45:00.000Z" }, // 11:00–11:45
      { professional_id: "p1", starts_at: "2026-11-03T17:30:00.000Z", ends_at: "2026-11-03T18:00:00.000Z" }, // 11:30–12:00
    ];
    expect(availableMinutes(day, rules, [])).toBe(240);
    expect(availableMinutes(day, rules, blocks)).toBe(180);
    expect(availableMinutes({ ...day, from: "2026-11-01", to: "2026-11-07" }, rules, [])).toBe(240);
  });

  it("ocupación = minutos reservados (sin canceladas) entre disponibles", () => {
    expect(occupancyFor(day, rules, [], SAME_DAY)).toMatchObject({ availableMinutes: 240, bookedMinutes: 60, occupancy: 0.25 });
  });

  it("muestra ingresos por profesional solo cuando se le pasan", () => {
    const base = {
      period: day,
      professionals: [
        { id: "p1", display_name: "Dra. Ruiz", professional_type: "medico", active: true },
        { id: "p2", display_name: "Dr. Antiguo", professional_type: "medico", active: false },
      ],
      rules,
      timeOff: [],
      appointments: SAME_DAY,
      typeLabels: new Map([["medico", "Hospital"]]),
    };
    const withRevenue = professionalsReport({ ...base, revenue: new Map([["p1", 45000]]), unattributedCents: 90000 });
    const rows = table(withRevenue, "profesionales").rows;
    expect(rows).toHaveLength(1); // el inactivo sin citas no aparece
    expect(rows[0].values).toMatchObject({ profesional: "Dra. Ruiz", area: "Hospital", disponible: 4, reservado: 1, ocupacion: 0.25, ingresos: 450 });
    expect(withRevenue.notes.join(" ")).toContain("$900.00");
    const without = professionalsReport({ ...base, revenue: null });
    expect(table(without, "profesionales").columns.map((c) => c.key)).not.toContain("ingresos");
  });
});

describe("pacientes y citas sin cobro", () => {
  const list = [
    appt("a1", "attended", "2026-11-03T16:00:00.000Z"),
    appt("a6", "attended", "2026-11-10T16:00:00.000Z"),
    appt("a7", "attended", "2026-11-11T16:00:00.000Z", { contact_id: "k2" }),
    appt("a2", "no_show", "2026-11-03T17:00:00.000Z", { contact_id: "k3" }),
  ];
  const contacts = new Map([
    ["k1", { id: "k1", full_name: "Ana", phone: "55 1", email: null }],
    ["k2", { id: "k2", full_name: "Beto", phone: null, email: "b@x.test" }],
    ["k3", { id: "k3", full_name: "Caro", phone: "55 3", email: null }],
  ]);

  it("distingue primera vez de recurrentes con la historia completa", () => {
    const r = patientsReport({ period: NOV, appointments: list, contacts, attendedBefore: new Set(["k2"]), newContacts: [], names: NAMES, spend: new Map([["k1", 90000]]) });
    expect(kpi(r, "Pacientes atendidos")).toBe(2);
    expect(kpi(r, "Primera vez")).toBe(1);
    expect(kpi(r, "Recurrentes")).toBe(1);
    expect(table(r, "frecuentes").rows.map((x) => [x.values.paciente, x.values.atendidas, x.values.tipo, x.values.gasto])).toEqual([
      ["Ana", 2, "Primera vez", 900],
      ["Beto", 1, "Recurrente", 0],
    ]);
    expect(table(r, "inasistencias").rows[0]).toMatchObject({ href: "/pacientes/k3", values: { paciente: "Caro", telefono: "55 3", no_asistio: 1 } });
  });

  it("estima lo pendiente al precio de lista", () => {
    const r = receivablesReport({
      period: NOV,
      appointments: list,
      charged: new Set(["a1"]),
      services: new Map([["s1", { name: "Consulta", price: 450 }]]),
      professionalNames: new Map([["p1", "Dra. Ruiz"]]),
      contactNames: new Map([...contacts].map(([id, c]) => [id, c.full_name])),
    });
    expect(kpi(r, "Citas sin cobro")).toBe(2);
    expect(kpi(r, "Importe estimado")).toBe(900);
    expect(kpi(r, "Atendidas cobradas")).toBeCloseTo(1 / 3);
    expect(table(r, "citas").rows.map((x) => x.values.fecha)).toEqual(["2026-11-10T10:00", "2026-11-11T10:00"]);
  });
});

// ---------------------------------------------------------------------------
describe("formato y CSV", () => {
  it("da formato legible y estable sin importar la zona del servidor", () => {
    expect(formatCell(1350, "money")).toBe("$1,350.00");
    expect(formatCell(null, "money")).toBe("—");
    expect(formatCell(0.255, "pct")).toBe("25.5%");
    expect(formatCell(12.5, "hours")).toBe("12.5 h");
    expect(formatCell("2026-11-03", "date")).toBe("mar, 3 nov 2026");
    expect(formatCell("2026-11-01", "month")).toBe("Noviembre de 2026");
    expect(formatCell("2026-11-03T08:05", "datetime")).toBe("3 nov 2026, 08:05");
    expect(formatCell("Total", "date")).toBe("Total");
  });

  it("exporta valores crudos, escapa comillas y neutraliza fórmulas", () => {
    expect(csvValue(1350, "money")).toBe("1350.00");
    expect(csvValue(0.255, "pct")).toBe("25.5");
    expect(csvValue("2026-11-03T08:05", "datetime")).toBe("2026-11-03 08:05");
    expect(csvValue("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvValue(-50, "money")).toBe("-50.00");
    const csv = tableToCsv({
      columns: [
        { key: "nombre", label: "Paciente" },
        { key: "importe", label: "Importe", format: "money" },
        { key: "tasa", label: "Asistencia", format: "pct" },
      ],
      rows: [{ values: { nombre: 'Ana "La Doc", MD', importe: 10.5, tasa: null } }],
      total: { nombre: "Total", importe: 10.5 },
    });
    expect(csv).toBe('Paciente,Importe (MXN),Asistencia (%)\r\n"Ana ""La Doc"", MD",10.50,\r\nTotal,10.50,\r\n');
  });
});
