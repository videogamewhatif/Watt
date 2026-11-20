import { describe, expect, it } from "vitest";
import { cellState, clipToDay, layoutLanes, visibleBounds, workingIntervals } from "@/features/agenda/grid";
import { agendaHref, agendaRange, parseAgendaQuery, stepDate } from "@/features/agenda/params";

describe("parámetros de la agenda", () => {
  const prof = "6f9d7a52-2a33-4c4e-9f53-0c4b1d1e6a11";

  it("valida y conserva fecha, vista y filtros", () => {
    const q = parseAgendaQuery({ fecha: "2026-11-19", vista: "semana", profesional: prof, estado: "pending" }, "2026-11-01");
    expect(q).toMatchObject({ date: "2026-11-19", view: "semana", professionalId: prof, status: "pending" });
    expect(agendaHref(q)).toBe(`/agenda?fecha=2026-11-19&vista=semana&profesional=${prof}&estado=pending`);
    expect(agendaHref(q, { date: stepDate(q, 1) })).toContain("fecha=2026-11-26");
  });

  it("ignora valores manipulados", () => {
    const q = parseAgendaQuery({ fecha: "2026-13-40", vista: "mes", profesional: "1 or 1=1", estado: "borrada" }, "2026-11-01");
    expect(q).toMatchObject({ date: "2026-11-01", view: null, professionalId: null, status: null });
  });

  it("calcula el rango por vista", () => {
    expect(agendaRange({ date: "2026-11-19", view: "semana" })).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(agendaRange({ date: "2026-11-19", view: null })).toEqual({ from: "2026-11-19", to: "2026-11-19" });
  });
});

describe("cuadrícula del calendario", () => {
  const rules = [
    { professional_id: "p", weekday: 4, start_time: "09:00:00", end_time: "13:00:00" },
    { professional_id: "p", weekday: 4, start_time: "15:00:00", end_time: "18:00:00" },
  ];

  it("distingue disponible, fuera de horario, bloqueo y pasado", () => {
    const working = workingIntervals(rules, "p", "2026-11-19");
    expect(working).toEqual([
      { start: 540, end: 780 },
      { start: 900, end: 1080 },
    ]);
    const blocks = [{ start: 660, end: 720 }];
    expect(cellState(600, 15, working, blocks, null)).toBe("available");
    expect(cellState(780, 15, working, blocks, null)).toBe("off"); // descanso 13:00–15:00
    expect(cellState(1080, 15, working, blocks, null)).toBe("off"); // fin de jornada
    expect(cellState(675, 15, working, blocks, null)).toBe("blocked");
    expect(cellState(720, 15, working, blocks, null)).toBe("available"); // [inicio, fin)
    expect(cellState(600, 15, working, blocks, 610)).toBe("past");
    expect(workingIntervals(rules, "p", "2026-11-21")).toEqual([]); // sábado
    // Una franja con cita vigente no se ofrece como disponible (ni a lectores de pantalla).
    expect(cellState(600, 15, working, [], null, [{ start: 600, end: 630 }])).toBe("busy");
    expect(cellState(630, 15, working, [], null, [{ start: 600, end: 630 }])).toBe("available");
  });

  it("recorta bloqueos de varios días al día visible", () => {
    const vacation = { local_start: "2026-11-18T00:00", local_end: "2026-11-21T00:00" };
    expect(clipToDay(vacation, "2026-11-19")).toEqual({ start: 0, end: 1440 });
    expect(clipToDay(vacation, "2026-11-21")).toBeNull();
    expect(clipToDay({ local_start: "2026-11-19T11:00", local_end: "2026-11-19T12:30" }, "2026-11-19")).toEqual({ start: 660, end: 750 });
  });

  it("acomoda citas traslapadas en carriles", () => {
    const placed = layoutLanes([
      { id: "a", start: 600, end: 630 },
      { id: "b", start: 600, end: 660 },
      { id: "c", start: 630, end: 660 },
      { id: "d", start: 700, end: 730 },
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(byId.b).toMatchObject({ lane: 0, lanes: 2 });
    expect(byId.a).toMatchObject({ lane: 1, lanes: 2 });
    expect(byId.c).toMatchObject({ lane: 1, lanes: 2 }); // reutiliza el carril de "a"
    expect(byId.d).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("ajusta el rango visible a horas completas", () => {
    expect(visibleBounds([{ start: 545, end: 1050 }])).toEqual({ start: 540, end: 1080 });
    expect(visibleBounds([])).toEqual({ start: 480, end: 1140 });
  });
});
