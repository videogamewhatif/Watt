import { describe, expect, it } from "vitest";
import { INITIAL_PAY, resolvePayment } from "@/features/cash/components/payment";

const pay = (patch: Partial<typeof INITIAL_PAY>) => ({ ...INITIAL_PAY, ...patch });

describe("forma de pago del ticket", () => {
  it("efectivo exacto si no se escribe con cuánto pagan", () => {
    const r = resolvePayment(450, pay({ mode: "cash" }));
    expect(r).toMatchObject({ problem: null, change: 0, payments: [{ method: "cash", amount: 450 }] });
  });

  it("calcula el cambio y avisa si falta efectivo", () => {
    expect(resolvePayment(450, pay({ mode: "cash", received: "500" }))).toMatchObject({ problem: null, change: 50 });
    expect(resolvePayment(450, pay({ mode: "cash", received: "400" })).problem).toMatch(/Faltan/);
  });

  it("tarjeta y transferencia cubren el total", () => {
    expect(resolvePayment(450, pay({ mode: "card", reference: "1234" }))).toMatchObject({ problem: null, payments: [{ method: "card", amount: 450, reference: "1234" }] });
    expect(resolvePayment(450, pay({ mode: "transfer" })).payments).toEqual([{ method: "transfer", amount: 450, reference: "" }]);
  });

  it("pago mixto: lo de tarjeta y el resto en efectivo, con cambio", () => {
    const r = resolvePayment(450, pay({ mode: "mixed", split: "300", received: "200" }));
    expect(r).toMatchObject({ problem: null, cashDue: 150, change: 50 });
    expect(r.payments.map((p) => [p.method, p.amount])).toEqual([
      ["card", 300],
      ["cash", 200],
    ]);
  });

  it("pago mixto pide un monto de tarjeta menor al total", () => {
    expect(resolvePayment(450, pay({ mode: "mixed" })).problem).toMatch(/tarjeta/);
    expect(resolvePayment(450, pay({ mode: "mixed", split: "450" })).problem).toMatch(/menor al total/);
  });
});
