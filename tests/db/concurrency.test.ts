// Escenario 6: reservas simultáneas. Sesiones reales de PostgreSQL en paralelo.
import { beforeAll, describe, expect, it } from "vitest";
import {
  book,
  buildFixture,
  expectPgError,
  type Fixture,
  freshDatabase,
  futureWeekday,
  type TestDb,
  type User,
  waitForLockWaiters,
} from "./helpers";

let db: TestDb;
let f: Fixture;
let reception2: User;
const TZ = "America/Mexico_City";

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
  reception2 = await db.createUser("recepcion2@clinica.test");
  const token = await db.as(f.users.clinicAdmin, async (s) =>
    (await s.one<{ token: string }>(`select token from public.create_invitation($1, $2, 'reception')`, [f.clinicId, reception2.email])).token,
  );
  await db.as(reception2, (s) => s.query(`select public.accept_invitation($1)`, [token]));
});

async function day(weeksAhead: number) {
  return futureWeekday(db, TZ, 2 + weeksAhead * 7, 2);
}

const ruiz = () => ({ professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: f.clinic.patientId });
const salas = () => ({ professionalId: f.clinic.salasId, serviceId: f.clinic.consultaId, contactId: f.clinic.patientId });

async function activeAt(professionalId: string, date: string, time: string) {
  return db.sql(
    `select id from public.appointments where professional_id = $1 and status in ('pending','confirmed')
     and starts_at = ($2::date + $3::time) at time zone $4`,
    [professionalId, date, time, TZ],
  );
}

describe("dos recepcionistas guardan el mismo horario al mismo tiempo", () => {
  it("la segunda espera el bloqueo y recibe 'slot_taken'; solo una cita existe", async () => {
    const d = await day(0);
    const a = await db.open(f.users.reception);
    const b = await db.open(reception2);
    try {
      await book(a, { ...ruiz(), date: d, time: "10:00" });
      const pendingB = book(b, { ...ruiz(), date: d, time: "10:00" });
      pendingB.catch(() => {});
      await waitForLockWaiters(db); // B está realmente bloqueada esperando a A
      await a.commit();
      const error = await expectPgError(pendingB);
      expect(error.message).toBe("slot_taken");
    } finally {
      await b.rollback();
      a.release();
      b.release();
    }
    expect(await activeAt(f.clinic.ruizId, d, "10:00")).toHaveLength(1);
  });

  it("de 12 intentos simultáneos solo uno se confirma", async () => {
    const d = await day(1);
    const users = [f.users.reception, reception2, f.users.clinicAdmin];
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => db.as(users[i % users.length], (s) => book(s, { ...ruiz(), date: d, time: "11:00" }))),
    );
    const ok = attempts.filter((r) => r.status === "fulfilled");
    const failed = attempts.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(11);
    for (const r of failed) expect(["slot_taken", "conflicting key value violates exclusion constraint \"appointments_no_overlap\""]).toContain(r.reason.message);
    expect(await activeAt(f.clinic.ruizId, d, "11:00")).toHaveLength(1);
  });

  it("dos profesionales distintos sí pueden reservar ese mismo horario simultáneamente", async () => {
    const d = await day(2);
    const [r1, r2] = await Promise.allSettled([
      db.as(f.users.reception, (s) => book(s, { ...ruiz(), date: d, time: "12:00" })),
      db.as(reception2, (s) => book(s, { ...salas(), date: d, time: "12:00" })),
    ]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
  });

  it("intentos solapados parcialmente (10:00 y 10:15) también se excluyen", async () => {
    const d = await day(3);
    const results = await Promise.allSettled([
      db.as(f.users.reception, (s) => book(s, { ...ruiz(), date: d, time: "10:00" })),
      db.as(reception2, (s) => book(s, { ...ruiz(), date: d, time: "10:15" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("la restricción de exclusión es la garantía final", () => {
  it("aun sin el trigger de validación, PostgreSQL rechaza traslapes y admite citas contiguas", async () => {
    const d = await day(4);
    const client = await db.pool.connect();
    const insert = (time: string, minutes: number) =>
      client.query(
        `insert into public.appointments (organization_id, professional_id, service_id, contact_id, starts_at, ends_at)
         values ($1, $2, $3, $4, ($5::date + $6::time) at time zone $7, ($5::date + $6::time + make_interval(mins => $8)) at time zone $7)`,
        [f.clinicId, f.clinic.ruizId, f.clinic.consultaId, f.clinic.patientId, d, time, TZ, minutes],
      );
    try {
      await client.query("begin");
      await client.query("alter table public.appointments disable trigger appointments_before_write");
      await insert("10:00", 30);
      await insert("10:30", 30); // contigua: válida
      const error = await expectPgError(insert("10:45", 30));
      expect(error.code).toBe("23P01");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});

describe("bloqueos y citas se mantienen consistentes bajo concurrencia", () => {
  it("una cita en curso de guardarse impide el bloqueo que la ocultaría", async () => {
    const d = await day(5);
    const a = await db.open(f.users.reception);
    const admin = await db.open(f.users.clinicAdmin);
    try {
      await book(a, { ...ruiz(), date: d, time: "10:00" });
      const pendingBlock = admin.query(
        `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind)
         values ($1, $2, ($3::date + time '09:00') at time zone $4, ($3::date + time '12:00') at time zone $4, 'absence')`,
        [f.clinicId, f.clinic.ruizId, d, TZ],
      );
      pendingBlock.catch(() => {});
      await waitForLockWaiters(db);
      await a.commit();
      expect((await expectPgError(pendingBlock)).message).toBe("time_off_conflict");
    } finally {
      await admin.rollback();
      a.release();
      admin.release();
    }
  });

  it("un bloqueo en curso de guardarse impide la cita", async () => {
    const d = await day(6);
    const admin = await db.open(f.users.clinicAdmin);
    const a = await db.open(f.users.reception);
    try {
      await admin.query(
        `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind)
         values ($1, $2, ($3::date + time '09:00') at time zone $4, ($3::date + time '12:00') at time zone $4, 'vacation')`,
        [f.clinicId, f.clinic.ruizId, d, TZ],
      );
      const pendingBooking = book(a, { ...ruiz(), date: d, time: "10:00" });
      pendingBooking.catch(() => {});
      await waitForLockWaiters(db);
      await admin.commit();
      expect((await expectPgError(pendingBooking)).message).toBe("blocked");
    } finally {
      await a.rollback();
      a.release();
      admin.release();
    }
  });
});

describe("reintentos y reprogramaciones concurrentes", () => {
  it("el mismo envío repetido (doble clic) devuelve la misma cita", async () => {
    const d = await day(7);
    const key = "0d1c2b3a-4f5e-4a7b-8c9d-0e1f2a3b4c5d";
    const a = await db.open(f.users.reception);
    const b = await db.open(f.users.reception);
    try {
      const first = await book(a, { ...ruiz(), date: d, time: "15:00", key });
      const pendingRetry = book(b, { ...ruiz(), date: d, time: "15:00", key });
      pendingRetry.catch(() => {});
      await waitForLockWaiters(db);
      await a.commit();
      const retry = await pendingRetry;
      await b.commit();
      expect(retry.id).toBe(first.id);
    } finally {
      a.release();
      b.release();
    }
    expect(await db.sql(`select id from public.appointments where idempotency_key = $1`, [key])).toHaveLength(1);
  });

  it("dos citas movidas al mismo horario: una se mueve y la otra conserva su horario original", async () => {
    const d = await day(8);
    const x = await db.as(f.users.reception, (s) => book(s, { ...ruiz(), date: d, time: "09:00" }));
    const y = await db.as(f.users.reception, (s) => book(s, { ...ruiz(), date: d, time: "09:30" }));
    const results = await Promise.allSettled([
      db.as(f.users.reception, (s) => s.query(`select public.reschedule_appointment($1, $2::date, '16:00')`, [x.id, d])),
      db.as(reception2, (s) => s.query(`select public.reschedule_appointment($1, $2::date, '16:00')`, [y.id, d])),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await db.sql<{ id: string; local: string }>(
      `select id, to_char(starts_at at time zone $2, 'HH24:MI') as local from public.appointments where id = any($1) order by local`,
      [[x.id, y.id], TZ],
    );
    const loser = results[0].status === "rejected" ? x.id : y.id;
    const original = loser === x.id ? "09:00" : "09:30";
    expect(rows.find((r) => r.id === loser)?.local).toBe(original);
    expect(rows.map((r) => r.local)).toContain("16:00");
  });
});
