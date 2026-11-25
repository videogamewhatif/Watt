import { describe, expect, it } from "vitest";
import { availableAreas, resolveArea } from "@/lib/practice";

describe("áreas de atención", () => {
  it("solo ofrece las áreas con profesionales activos, en orden fijo", () => {
    expect(availableAreas(["dentista", "medico", "otro", "dentista"]).map((a) => a.label)).toEqual(["Hospital", "Dentista"]);
  });

  it("respeta el área guardada solo si está disponible", () => {
    const areas = availableAreas(["medico", "dentista"]);
    expect(resolveArea("dentista", areas)).toBe("dentista");
    expect(resolveArea("optica", areas)).toBeNull();
    expect(resolveArea(undefined, areas)).toBeNull();
  });

  it("no filtra cuando el espacio tiene una sola área", () => {
    expect(resolveArea("medico", availableAreas(["medico"]))).toBeNull();
  });
});
