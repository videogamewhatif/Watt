// Escenario 9: la agenda usa la zona del espacio aunque el navegador esté en otro país.
// Este proyecto de pruebas corre con TZ=Asia/Tokyo (ver vitest.config.mts).
import { describe, expect, it } from "vitest";
import {
  addDays,
  eachDay,
  formatLongDate,
  formatShortDate,
  formatWeekRange,
  isLocalDate,
  isoWeekday,
  localParts,
  startOfWeek,
  todayIn,
  zonedToInstant,
} from "@/lib/tz";

describe("zona horaria del espacio", () => {
  it("el proceso de pruebas realmente usa otra zona", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Tokyo");
  });

  it("calcula 'hoy' en la zona del espacio, no en la del navegador", () => {
    // 2026-11-19 03:00 UTC = 18 nov 21:00 en Ciudad de México = 19 nov 12:00 en Tokio.
    const instant = new Date("2026-11-19T03:00:00Z");
    expect(todayIn("America/Mexico_City", instant)).toBe("2026-11-18");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-11-19");
  });

  it("muestra la hora local del consultorio", () => {
    expect(localParts("2026-11-19T16:00:00Z", "America/Mexico_City")).toEqual({ date: "2026-11-19", time: "10:00", minutes: 600 });
    expect(localParts("2026-11-19T16:00:00Z", "America/Cancun")).toEqual({ date: "2026-11-19", time: "11:00", minutes: 660 });
  });

  it("convierte hora local del espacio a instante (con y sin horario de verano)", () => {
    expect(zonedToInstant("2026-11-19", "10:00", "America/Mexico_City").toISOString()).toBe("2026-11-19T16:00:00.000Z");
    expect(zonedToInstant("2026-07-15", "09:00", "America/Tijuana").toISOString()).toBe("2026-07-15T16:00:00.000Z"); // PDT
    expect(zonedToInstant("2026-12-15", "09:00", "America/Tijuana").toISOString()).toBe("2026-12-15T17:00:00.000Z"); // PST
    expect(zonedToInstant("2026-11-19", "00:00", "America/Mexico_City").toISOString()).toBe("2026-11-19T06:00:00.000Z");
  });

  it("la aritmética de fechas no depende de la zona del proceso", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // cambio de horario en EE. UU.
    expect(isoWeekday("2026-11-19")).toBe(4); // jueves
    expect(isoWeekday("2026-11-22")).toBe(7); // domingo
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16");
    expect(eachDay("2026-11-16", "2026-11-18")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-02-28")).toBe(true);
  });

  it("formatea en español de México", () => {
    expect(formatLongDate("2026-11-19")).toBe("Jueves, 19 de noviembre de 2026");
    expect(formatShortDate("2026-11-19")).toMatch(/^jue/);
    expect(formatWeekRange("2026-11-16", "2026-11-22")).toBe("16 – 22 de noviembre de 2026");
  });
});
