import { describe, expect, it } from "vitest";
import { chargeTotals, formatMoney, netPayments, parseMoney, settle, sumMoney } from "@/lib/money";

describe("dinero", () => {
  it("lee importes escritos por personas y rechaza los inválidos", () => {
    expect(parseMoney("1,250.50")).toBe(1250.5);
    expect(parseMoney("$300")).toBe(300);
    expect(parseMoney(" 12. ")).toBe(12);
    expect(parseMoney("0.1")).toBe(0.1);
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "10,5,5x", "99999999"]) expect(parseMoney(bad), bad).toBeNull();
  });

  it("suma sin errores de punto flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(chargeTotals([{ quantity: 3, unitPrice: 0.1 }, { quantity: 1, unitPrice: 800.5 }], 0.3).total).toBe(800.5);
  });

  it("formatea en pesos mexicanos", () => {
    expect(formatMoney(1250.5)).toMatch(/^\$1,250\.50$/);
    expect(formatMoney(null)).toMatch(/^\$0\.00$/);
  });

  it("calcula faltante y cambio: solo el efectivo da cambio", () => {
    expect(settle(450, [{ method: "cash", amount: 500 }])).toEqual({ due: 0, change: 50, exact: true });
    expect(settle(450, [{ method: "cash", amount: 400 }])).toEqual({ due: 50, change: 0, exact: false });
    expect(settle(450, [{ method: "card", amount: 450 }])).toEqual({ due: 0, change: 0, exact: true });
    expect(settle(450, [{ method: "card", amount: 500 }]).exact).toBe(false);
    // Tarjeta exacta + efectivo con cambio.
    expect(settle(450, [{ method: "card", amount: 200 }, { method: "cash", amount: 300 }])).toEqual({ due: 0, change: 50, exact: true });
    // El cambio nunca puede exceder el efectivo recibido.
    expect(settle(450, [{ method: "card", amount: 400 }, { method: "cash", amount: 20 }])).toEqual({ due: 30, change: 0, exact: false });
  });

  it("guarda el efectivo neto de cambio para que los pagos sumen el total", () => {
    const net = netPayments(450, [{ method: "card", amount: 200 }, { method: "cash", amount: 300 }]);
    expect(net).toEqual([{ method: "card", amount: 200 }, { method: "cash", amount: 250 }]);
    expect(sumMoney(net.map((p) => p.amount))).toBe(450);
    expect(netPayments(450, [{ method: "cash", amount: 450 }])).toEqual([{ method: "cash", amount: 450 }]);
    expect(netPayments(450, [{ method: "cash", amount: 500 }])).toEqual([{ method: "cash", amount: 450 }]);
  });
});
