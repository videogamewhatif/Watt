import { describe, expect, it } from "vitest";
import { errorCode, errorMessage } from "@/lib/errors";
import { resolveConfirmNext, safeNext } from "@/lib/redirects";

describe("mensajes de error", () => {
  it("traduce errores de negocio y restricciones", () => {
    expect(errorMessage({ message: "slot_taken", code: "P0001" })).toMatch(/ocupado/);
    expect(errorCode({ message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"', code: "23P01" })).toBe("slot_taken");
    expect(errorCode({ message: "x availability_rules_no_overlap", code: "23P01" })).toBe("schedule_overlap");
    expect(errorMessage({ message: "new row violates row-level security policy", code: "42501" })).toMatch(/permiso/);
    expect(errorMessage(null)).toMatch(/Intenta de nuevo/);
  });
});

describe("redirecciones seguras", () => {
  it("solo acepta rutas internas", () => {
    expect(safeNext("/invitacion/abc")).toBe("/invitacion/abc");
    expect(safeNext("//evil.test/x")).toBe("/inicio");
    expect(safeNext("https://evil.test/x", "https://app.test")).toBe("/inicio");
    expect(safeNext("https://app.test/agenda?x=1", "https://app.test")).toBe("/agenda?x=1");
    expect(safeNext(null)).toBe("/inicio");
  });
});

describe("enlaces de confirmación", () => {
  const origin = "https://app.test";
  it("conserva el destino (p. ej. una invitación) con la plantilla token_hash", () => {
    // {{ .RedirectTo }} = emailRedirectTo = https://app.test/auth/confirm?next=/invitacion/T
    expect(resolveConfirmNext("https://app.test/auth/confirm?next=/invitacion/T", origin)).toBe("/invitacion/T");
    expect(resolveConfirmNext("https://app.test/auth/confirm?next=%2Fbienvenida", origin)).toBe("/bienvenida");
  });
  it("con el flujo PKCE el destino llega directo", () => {
    expect(resolveConfirmNext("/invitacion/T", origin)).toBe("/invitacion/T");
    expect(resolveConfirmNext("https://otro.test/x", origin)).toBe("/inicio");
  });
});
