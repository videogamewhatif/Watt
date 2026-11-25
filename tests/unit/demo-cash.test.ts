// La caja del modo de prueba debe comportarse como las funciones SQL de la migración 0005.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoClient } from "@/lib/demo/client";
import { getDemoStore, resetDemoStore } from "@/lib/demo/data";
import { DEMO_PERSONAS } from "@/lib/demo/personas";

const [admin, reception, professional, independent] = DEMO_PERSONAS.map((p) => createDemoClient(p.id));
const CLINIC = "b0000000-0000-4000-8000-000000000001";
const INDEP = "b0000000-0000-4000-8000-000000000002";
const CONSULTA = "d0000000-0000-4000-8000-000000000001"; // $450
const LIMPIEZA = "d0000000-0000-4000-8000-000000000004"; // $700

beforeEach(() => resetDemoStore());

const cash = (amount: number) => [{ method: "cash", amount }];
const svc = (service_id: string, quantity = 1) => ({ service_id, description: "", quantity, unit_price: 1 });

async function open(client = reception, amount = 500) {
  const { data, error } = await client.rpc("open_cash_session", { p_organization_id: CLINIC, p_opening_amount: amount });
  expect(error).toBeNull();
  return data!;
}

describe("caja en modo de prueba", () => {
  it("trae un turno anterior cerrado con una cancelación y una diferencia", async () => {
    const { data: sessions } = await reception.from("cash_sessions").select("*").eq("organization_id", CLINIC);
    expect(sessions).toHaveLength(1);
    expect(sessions![0].closed_at).not.toBeNull();
    expect(sessions![0].difference).toBe(-10);
    const { data: totals } = await reception.rpc("cash_session_totals", { p_session_id: sessions![0].id });
    expect(totals![0]).toMatchObject({ cash_sales: 450, card_sales: 700, transfer_sales: 0, voided_count: 1, voided_total: 300, expected_cash: 800 + 450 - 120 });
  });

  it("solo una caja abierta por espacio; sin turno no se cobra", async () => {
    const early = await reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA)], p_payments: cash(450) });
    expect(early.error?.message).toBe("no_open_cash_session");
    await open();
    const again = await admin.rpc("open_cash_session", { p_organization_id: CLINIC, p_opening_amount: 0 });
    expect(again.error?.message).toBe("cash_session_already_open");
    const bad = await independent.rpc("open_cash_session", { p_organization_id: INDEP, p_opening_amount: -1 });
    expect(bad.error?.message).toBe("invalid_amount");
  });

  it("cobra con el precio del servidor, exige pagos exactos y no duplica con la misma clave", async () => {
    await open();
    const key = crypto.randomUUID();
    const charge = (payments: unknown, extra: object = {}) =>
      reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA, 2), svc(LIMPIEZA)], p_payments: payments as never, p_idempotency_key: key, ...extra });
    const short = await charge(cash(1599));
    expect(short.error?.message).toBe("payment_mismatch");
    const ok = await charge([{ method: "cash", amount: 1000 }, { method: "card", amount: 600 }]);
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ subtotal: 1600, total: 1600, status: "paid" });
    const retry = await charge([{ method: "cash", amount: 1000 }, { method: "card", amount: 600 }]);
    expect(retry.data!.id).toBe(ok.data!.id);
    expect(getDemoStore().charges.filter((c) => c.idempotency_key === key)).toHaveLength(1);
    const discount = await reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA)], p_payments: cash(450), p_discount: 450 });
    expect(discount.error?.message).toBe("invalid_amount");
  });

  it("una cita se cobra una sola vez y las canceladas no se cobran", async () => {
    await open();
    const { data: appts } = await reception.from("appointments").select("id, status").eq("organization_id", CLINIC);
    const live = appts!.find((a) => a.status === "confirmed")!;
    const cancelled = appts!.find((a) => a.status === "cancelled")!;
    const pay = (appointment: string) => reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA)], p_payments: cash(450), p_appointment_id: appointment });
    expect((await pay(live.id)).error).toBeNull();
    expect((await pay(live.id)).error?.message).toBe("appointment_already_charged");
    expect((await pay(cancelled.id)).error?.message).toBe("appointment_not_chargeable");
  });

  it("solo administración cancela cobros, con motivo; el cobro cancelado sale de los totales", async () => {
    const session = await open();
    const { data: charge } = await reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA)], p_payments: cash(450) });
    expect((await reception.rpc("void_charge", { p_charge_id: charge!.id, p_reason: "Error de captura" })).error?.message).toBe("forbidden");
    expect((await admin.rpc("void_charge", { p_charge_id: charge!.id, p_reason: " " })).error?.message).toBe("void_reason_required");
    expect((await admin.rpc("void_charge", { p_charge_id: charge!.id, p_reason: "Error de captura" })).error).toBeNull();
    expect((await admin.rpc("void_charge", { p_charge_id: charge!.id, p_reason: "Otra vez" })).error?.message).toBe("charge_already_voided");
    const { data: totals } = await admin.rpc("cash_session_totals", { p_session_id: session.id });
    expect(totals![0]).toMatchObject({ cash_sales: 0, charges_count: 0, voided_count: 1, expected_cash: 500 });
  });

  it("controla las salidas de efectivo y exige nota si el corte no cuadra", async () => {
    const session = await open(reception, 100);
    await reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA)], p_payments: cash(450) });
    expect((await reception.rpc("add_cash_movement", { p_organization_id: CLINIC, p_kind: "out", p_amount: 551, p_concept: "Demasiado" })).error?.message).toBe("insufficient_cash");
    expect((await reception.rpc("add_cash_movement", { p_organization_id: CLINIC, p_kind: "out", p_amount: 50, p_concept: "Papelería" })).error).toBeNull();
    const close = (counted: number, notes?: string) => reception.rpc("close_cash_session", { p_session_id: session.id, p_counted_amount: counted, p_notes: notes ?? null });
    expect((await close(490)).error?.message).toBe("difference_needs_note");
    const closed = await close(490, "Faltaron 10 pesos");
    expect(closed.data).toMatchObject({ expected_cash: 500, counted_cash: 490, difference: -10 });
    expect((await close(500)).error?.message).toBe("cash_session_closed");
    expect((await reception.rpc("create_charge", { p_organization_id: CLINIC, p_items: [svc(CONSULTA)], p_payments: cash(450) })).error?.message).toBe("no_open_cash_session");
  });

  it("el profesional no ve ni opera la caja y cada espacio tiene la suya", async () => {
    await open();
    expect((await professional.from("cash_sessions").select("id")).data).toEqual([]);
    expect((await professional.from("charges").select("id")).data).toEqual([]);
    expect((await professional.rpc("open_cash_session", { p_organization_id: CLINIC, p_opening_amount: 0 })).error?.code).toBe("42501");
    expect((await independent.from("cash_sessions").select("id").eq("organization_id", CLINIC)).data).toEqual([]);
    expect((await reception.from("charges").delete().eq("organization_id", CLINIC).select("id")).data).toEqual([]);
  });
});
