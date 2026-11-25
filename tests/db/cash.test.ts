// Caja: turnos, cobros, cancelaciones, movimientos de efectivo y corte.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { book, buildFixture, expectPgError, type Fixture, freshDatabase, type Session, type TestDb, waitForLockWaiters } from "./helpers";

let db: TestDb;
let f: Fixture;

const cashPay = (amount: number) => JSON.stringify([{ method: "cash", amount }]);
const item = (serviceId: string | null, quantity = 1, description = "Concepto libre", unitPrice = 100) =>
  ({ service_id: serviceId, description, quantity, unit_price: unitPrice });

async function openSession(s: Session, org = f.clinicId, amount = 500) {
  return s.one<{ id: string }>(`select * from public.open_cash_session($1, $2, null)`, [org, amount]);
}

async function charge(
  s: Session,
  args: {
    items: unknown[];
    payments: string;
    discount?: number;
    contactId?: string | null;
    appointmentId?: string | null;
    key?: string | null;
    org?: string;
  },
) {
  return s.one<{ id: string; folio: number; total: string; subtotal: string; contact_id: string | null }>(
    `select * from public.create_charge($1, $2::jsonb, $3::jsonb, $4, $5, $6, null, $7)`,
    [args.org ?? f.clinicId, JSON.stringify(args.items), args.payments, args.discount ?? 0, args.contactId ?? null, args.appointmentId ?? null, args.key ?? null],
  );
}

async function totals(s: Session, sessionId: string) {
  const t = await s.one<Record<string, string | number>>(`select * from public.cash_session_totals($1)`, [sessionId]);
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(v)]));
}

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
  await db.as(f.users.clinicAdmin, async (s) => {
    await s.query(`update public.services set price = 450 where id = $1`, [f.clinic.consultaId]);
    await s.query(`update public.services set price = 800.50 where id = $1`, [f.clinic.limpiezaId]);
  });
});

describe("Turno de caja", () => {
  it("no se cobra ni se mueve efectivo sin un turno abierto", async () => {
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450) }))).message).toBe("no_open_cash_session");
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(s.query(`select public.add_cash_movement($1, 'out', 10, 'Papelería')`, [f.clinicId]))).message).toBe(
        "no_open_cash_session",
      );
    });
  });

  it("solo puede haber un turno abierto por espacio, y el monto de apertura debe ser válido", async () => {
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(s.query(`select public.open_cash_session($1, -5)`, [f.clinicId]))).message).toBe("invalid_amount");
    });
    const first = await db.as(f.users.reception, (s) => openSession(s));
    expect(first.id).toBeTruthy();
    await db.as(f.users.clinicAdmin, async (s) => {
      expect((await expectPgError(s.query(`select public.open_cash_session($1, 0)`, [f.clinicId]))).message).toBe("cash_session_already_open");
    });
    // Otro espacio tiene su propia caja.
    await db.as(f.users.drHerrera, async (s) => {
      const other = await openSession(s, f.indepId, 200);
      expect(other.id).toBeTruthy();
      await s.query(`select public.close_cash_session($1, 200)`, [other.id]);
    });
    await db.as(f.users.clinicAdmin, async (s) => {
      await s.query(`select public.close_cash_session($1, 500)`, [first.id]);
    });
  });
});

describe("Cobros", () => {
  let sessionId: string;
  let patientTwoId: string;

  beforeAll(async () => {
    sessionId = (await db.as(f.users.reception, (s) => openSession(s, f.clinicId, 1000))).id;
    patientTwoId = await db.as(f.users.reception, async (s) =>
      (await s.one<{ id: string }>(`insert into public.contacts (organization_id, full_name, phone) values ($1, 'Otra Paciente', '5599998888') returning id`, [f.clinicId])).id,
    );
  });

  it("cobra servicios con el precio del servidor, calcula el total y numera con folios consecutivos", async () => {
    await db.as(f.users.reception, async (s) => {
      // El navegador intenta mandar otro precio: se ignora.
      const c1 = await charge(s, {
        items: [item(f.clinic.consultaId, 2, "x", 1), item(f.clinic.limpiezaId, 1, "y", 1)],
        payments: JSON.stringify([
          { method: "cash", amount: 1000 },
          { method: "card", amount: 700.5, reference: "4242" },
        ]),
        contactId: f.clinic.patientId,
      });
      expect(Number(c1.subtotal)).toBe(1700.5);
      expect(Number(c1.total)).toBe(1700.5);
      const lines = await s.query<{ description: string; unit_price: string; amount: string }>(
        `select description, unit_price, amount from public.charge_items where charge_id = $1 order by id`,
        [c1.id],
      );
      expect(lines.map((l) => [l.description, Number(l.unit_price), Number(l.amount)])).toEqual([
        ["Consulta general", 450, 900],
        ["Limpieza dental", 800.5, 800.5],
      ]);
      const c2 = await charge(s, { items: [item(null, 1, "Certificado médico", 250)], payments: cashPay(225), discount: 25 });
      expect(c2.folio).toBe(c1.folio + 1);
      expect(Number(c2.total)).toBe(225);
    });
  });

  it("exige que los pagos sumen exactamente el total y valida descuentos y montos", async () => {
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(449.99) }))).message).toBe("payment_mismatch");
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(500) }))).message).toBe("payment_mismatch");
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(0), discount: 450 }))).message).toBe("invalid_amount");
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(null, 1, "Libre", -1)], payments: cashPay(1) }))).message).toBe("invalid_amount");
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [], payments: cashPay(1) }))).message).toBe("invalid_charge");
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(randomUUID())], payments: cashPay(1) }))).message).toBe("service_not_found");
    });
  });

  it("un reintento con la misma clave no duplica el cobro", async () => {
    const key = randomUUID();
    const ids = await db.as(f.users.reception, async (s) => {
      const a = await charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450), key });
      const b = await charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450), key });
      return [a.id, b.id];
    });
    expect(ids[0]).toBe(ids[1]);
  });

  it("una cita se cobra una sola vez y no se cobran citas canceladas", async () => {
    const future = await db.as(f.users.reception, async (s) => ({
      a: await book(s, { professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: f.clinic.patientId, date: f.day, time: "09:00" }),
      b: await book(s, { professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: patientTwoId, date: f.day, time: "10:00" }),
    }));
    await db.as(f.users.reception, async (s) => {
      const c = await charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450), appointmentId: future.a.id });
      expect(c.contact_id).toBe(f.clinic.patientId); // toma al paciente de la cita
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450), appointmentId: future.a.id }))).message).toBe(
        "appointment_already_charged",
      );
    });
    await db.as(f.users.reception, async (s) => {
      await s.query(`select public.set_appointment_status($1, 'cancelled', 'Prueba')`, [future.b.id]);
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450), appointmentId: future.b.id }))).message).toBe(
        "appointment_not_chargeable",
      );
    });
  });

  it("los totales del turno separan efectivo, tarjeta y transferencia", async () => {
    await db.as(f.users.reception, async (s) => {
      await charge(s, {
        items: [item(null, 1, "Mixto", 300)],
        payments: JSON.stringify([
          { method: "transfer", amount: 100 },
          { method: "card", amount: 50 },
          { method: "cash", amount: 150 },
        ]),
      });
      const t = await totals(s, sessionId);
      expect(t.opening_amount).toBe(1000);
      expect(t.card_sales).toBe(700.5 + 50);
      expect(t.transfer_sales).toBe(100);
      // 1000 (efectivo) + 225 + 450 (reintento) + 450 (cita) + 150
      expect(t.cash_sales).toBe(1000 + 225 + 450 + 450 + 150);
      expect(t.expected_cash).toBe(1000 + t.cash_sales);
    });
  });
});

describe("Permisos", () => {
  it("el profesional no ve ni opera la caja; otro espacio tampoco", async () => {
    await db.as(f.users.drRuiz, async (s) => {
      expect(await s.query(`select id from public.cash_sessions`)).toHaveLength(0);
      expect(await s.query(`select id from public.charges`)).toHaveLength(0);
      expect(await s.query(`select id from public.payments`)).toHaveLength(0);
    });
    await db.as(f.users.drRuiz, async (s) => {
      expect((await expectPgError(s.query(`select public.open_cash_session($1, 0)`, [f.clinicId]))).message).toBe("forbidden");
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect(await s.query(`select id from public.charges where organization_id = $1`, [f.clinicId])).toHaveLength(0);
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(charge(s, { items: [item(f.clinic.consultaId)], payments: cashPay(450) }))).message).toBe("forbidden");
    });
  });

  it("nadie escribe directamente en las tablas de caja", async () => {
    await db.as(f.users.clinicAdmin, async (s) => {
      expect((await expectPgError(s.query(`update public.charges set total = 1`))).code).toBe("42501");
    });
    await db.as(f.users.clinicAdmin, async (s) => {
      expect((await expectPgError(s.query(`delete from public.payments`))).code).toBe("42501");
    });
    await db.as(f.users.clinicAdmin, async (s) => {
      expect((await expectPgError(s.query(`insert into public.cash_movements (organization_id, session_id, kind, amount, concept) values ($1, $2, 'in', 1, 'x')`, [f.clinicId, randomUUID()]))).code).toBe("42501");
    });
  });

  it("solo Administración fija precios de servicios", async () => {
    await db.as(f.users.reception, async (s) => {
      expect(await s.query(`update public.services set price = 1 where id = $1 returning id`, [f.clinic.consultaId])).toHaveLength(0);
    });
  });
});

describe("Movimientos, cancelaciones y corte", () => {
  let sessionId: string;
  let chargeId: string;

  beforeAll(async () => {
    sessionId = (await db.as(f.users.drHerrera, (s) => openSession(s, f.indepId, 200))).id;
  });

  it("registra entradas y salidas, y no permite sacar más efectivo del que hay", async () => {
    await db.as(f.users.drHerrera, async (s) => {
      chargeId = (await charge(s, { org: f.indepId, items: [item(null, 1, "Consulta", 300)], payments: cashPay(300) })).id;
      await s.query(`select public.add_cash_movement($1, 'out', 100, 'Compra de insumos')`, [f.indepId]);
      await s.query(`select public.add_cash_movement($1, 'in', 50, 'Cambio de banco')`, [f.indepId]);
      expect((await totals(s, sessionId)).expected_cash).toBe(200 + 300 - 100 + 50);
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(s.query(`select public.add_cash_movement($1, 'out', 451, 'Demasiado')`, [f.indepId]))).message).toBe("insufficient_cash");
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(s.query(`select public.add_cash_movement($1, 'out', 5, 'x')`, [f.indepId]))).message).toBe("concept_required");
    });
  });

  it("cancelar un cobro exige motivo, lo excluye de los totales y no puede dejar la caja en negativo", async () => {
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(s.query(`select public.void_charge($1, '  ')`, [chargeId]))).message).toBe("void_reason_required");
    });
    await db.as(f.users.drHerrera, async (s) => {
      // Efectivo esperado 450; el cobro aportó 300, quedaría en 150: permitido.
      await s.query(`select public.add_cash_movement($1, 'out', 300, 'Retiro a caja fuerte')`, [f.indepId]);
    });
    await db.as(f.users.drHerrera, async (s) => {
      // Esperado 150: cancelar 300 en efectivo lo dejaría en -150.
      expect((await expectPgError(s.query(`select public.void_charge($1, 'Cobro duplicado')`, [chargeId]))).message).toBe("insufficient_cash");
    });
    await db.as(f.users.drHerrera, async (s) => {
      await s.query(`select public.add_cash_movement($1, 'in', 300, 'Reintegro')`, [f.indepId]);
      await s.query(`select public.void_charge($1, 'Cobro duplicado')`, [chargeId]);
      const t = await totals(s, sessionId);
      expect(t.cash_sales).toBe(0);
      expect(t.charges_count).toBe(0);
      expect(t.voided_count).toBe(1);
      expect(t.voided_total).toBe(300);
      expect(t.expected_cash).toBe(200 - 100 + 50 - 300 + 300);
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(s.query(`select public.void_charge($1, 'Otra vez')`, [chargeId]))).message).toBe("charge_already_voided");
    });
  });

  it("solo Administración cancela cobros; Recepción no", async () => {
    const id = await db.as(f.users.reception, async (s) => {
      const open = await s.query<{ id: string }>(`select id from public.cash_sessions where organization_id = $1 and closed_at is null`, [f.clinicId]);
      expect(open).toHaveLength(1);
      return (await s.one<{ id: string }>(`select id from public.charges where organization_id = $1 and status = 'paid' limit 1`, [f.clinicId])).id;
    });
    await db.as(f.users.reception, async (s) => {
      expect((await expectPgError(s.query(`select public.void_charge($1, 'No debería poder')`, [id]))).message).toBe("forbidden");
    });
    await db.as(f.users.clinicAdmin, async (s) => {
      const voided = await s.one<{ status: string; voided_at: Date | null }>(`select * from public.void_charge($1, 'Error de captura')`, [id]);
      expect(voided.status).toBe("voided");
      expect(voided.voided_at).not.toBeNull();
    });
  });

  it("el corte compara contra lo esperado, exige motivo si hay diferencia y deja el turno inmutable", async () => {
    await db.as(f.users.drHerrera, async (s) => {
      const t = await totals(s, sessionId); // 150
      expect(t.expected_cash).toBe(150);
      expect((await expectPgError(s.query(`select public.close_cash_session($1, 140)`, [sessionId]))).message).toBe("difference_needs_note");
    });
    const closed = await db.as(f.users.drHerrera, (s) =>
      s.one<{ expected_cash: string; counted_cash: string; difference: string; closed_at: Date | null }>(
        `select * from public.close_cash_session($1, 140, 'Faltaron 10 pesos de cambio')`,
        [sessionId],
      ),
    );
    expect(Number(closed.expected_cash)).toBe(150);
    expect(Number(closed.difference)).toBe(-10);
    expect(closed.closed_at).not.toBeNull();

    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(s.query(`select public.close_cash_session($1, 150)`, [sessionId]))).message).toBe("cash_session_closed");
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(charge(s, { org: f.indepId, items: [item(null, 1, "Tarde", 10)], payments: cashPay(10) }))).message).toBe("no_open_cash_session");
    });
    await db.as(f.users.drHerrera, async (s) => {
      expect((await expectPgError(s.query(`select public.add_cash_movement($1, 'in', 5, 'Fuera de turno')`, [f.indepId]))).message).toBe("no_open_cash_session");
    });
    // Un turno cerrado no admite cancelaciones (el cobro ya estaba cancelado; probamos con uno nuevo en otro turno).
    await db.as(f.users.drHerrera, async (s) => {
      await openSession(s, f.indepId, 0);
      const c = await charge(s, { org: f.indepId, items: [item(null, 1, "Nuevo", 40)], payments: cashPay(40) });
      const next = await s.one<{ id: string }>(`select id from public.cash_sessions where organization_id = $1 and closed_at is null`, [f.indepId]);
      await s.query(`select public.close_cash_session($1, 40)`, [next.id]);
      expect((await expectPgError(s.query(`select public.void_charge($1, 'Tarde')`, [c.id]))).message).toBe("cash_session_closed");
    });
  });

  it("un corte sin diferencia no necesita comentario", async () => {
    const id = await db.as(f.users.reception, async (s) => {
      const open = await s.one<{ id: string }>(`select id from public.cash_sessions where organization_id = $1 and closed_at is null`, [f.clinicId]);
      const t = await totals(s, open.id);
      const closed = await s.one<{ difference: string }>(`select * from public.close_cash_session($1, $2)`, [open.id, t.expected_cash]);
      expect(Number(closed.difference)).toBe(0);
      return open.id;
    });
    expect(id).toBeTruthy();
  });
});

describe("Concurrencia", () => {
  it("el corte espera a un cobro en curso y lo incluye; el cobro posterior al corte se rechaza", async () => {
    const sessionId = (await db.as(f.users.clinicAdmin, (s) => openSession(s, f.clinicId, 0))).id;
    const a = await db.open(f.users.reception);
    const b = await db.open(f.users.clinicAdmin);
    try {
      await a.query(`select public.create_charge($1, $2::jsonb, $3::jsonb)`, [f.clinicId, JSON.stringify([item(null, 1, "En curso", 100)]), cashPay(100)]);
      const closing = b.query(`select public.close_cash_session($1, 100)`, [sessionId]);
      await waitForLockWaiters(db);
      await a.commit();
      await closing; // vio el cobro confirmado: esperado 100, sin diferencia
      await b.commit();
    } finally {
      await a.rollback();
      await b.rollback();
      a.release();
      b.release();
    }
    const row = await db.one<{ expected_cash: string; difference: string }>(`select expected_cash, difference from public.cash_sessions where id = $1`, [sessionId]);
    expect(Number(row.expected_cash)).toBe(100);
    expect(Number(row.difference)).toBe(0);
  });
});

describe("Integridad", () => {
  it("eliminar un espacio con cobros elimina también su caja (el seed reinicia espacios completos)", async () => {
    await db.sql(`delete from public.organizations where id = $1`, [f.indepId]);
    expect((await db.one<{ n: number }>(`select count(*)::int as n from public.charges where organization_id = $1`, [f.indepId])).n).toBe(0);
    expect((await db.one<{ n: number }>(`select count(*)::int as n from public.payments where organization_id = $1`, [f.indepId])).n).toBe(0);
    expect((await db.one<{ n: number }>(`select count(*)::int as n from public.cash_movements where organization_id = $1`, [f.indepId])).n).toBe(0);
  });

  it("no se borra un paciente que ya tiene cobros", async () => {
    await db.as(f.users.reception, async (s) => {
      await openSession(s, f.clinicId, 0);
      await charge(s, { items: [item(null, 1, "Libre", 10)], payments: cashPay(10), contactId: f.clinic.patientId });
    });
    await db.as(f.users.clinicAdmin, async (s) => {
      expect((await expectPgError(s.query(`delete from public.contacts where id = $1`, [f.clinic.patientId]))).code).toBe("23503");
    });
  });
});
