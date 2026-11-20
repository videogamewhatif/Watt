// Escenarios 7, 8 y 9: reglas de disponibilidad, estados, reprogramación y zona horaria.
import { beforeAll, describe, expect, it } from "vitest";
import { book, buildFixture, expectPgError, type Fixture, freshDatabase, futureWeekday, type TestDb } from "./helpers";

let db: TestDb;
let f: Fixture;
const TZ = "America/Mexico_City";

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
});

/** Cada prueba usa un miércoles distinto para no interferir con las demás. */
async function day(weeksAhead: number) {
  return futureWeekday(db, TZ, 2 + weeksAhead * 7, 3);
}

const ruiz = () => ({ professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: f.clinic.patientId });
const salas = () => ({ professionalId: f.clinic.salasId, serviceId: f.clinic.limpiezaId, contactId: f.clinic.patientId });

async function bookAs(args: Parameters<typeof book>[1]) {
  return db.as(f.users.reception, (s) => book(s, args));
}

async function bookError(args: Parameters<typeof book>[1]) {
  return (await expectPgError(bookAs(args))).message;
}

describe("disponibilidad", () => {
  it("una cita que comienza justo al terminar otra es válida ([inicio, fin))", async () => {
    const d = await day(0);
    const first = await bookAs({ ...ruiz(), date: d, time: "10:00" });
    const second = await bookAs({ ...ruiz(), date: d, time: "10:30" });
    expect(new Date(first.ends_at).getTime()).toBe(new Date(second.starts_at).getTime());
    expect(await bookError({ ...ruiz(), date: d, time: "10:15" })).toBe("slot_taken");
  });

  it("la cita debe caber completa en el bloque: 45 min no caben a las 12:30 si se termina a las 13:00", async () => {
    const d = await day(1);
    expect(await bookError({ ...salas(), date: d, time: "12:30" })).toBe("outside_schedule");
    const ok = await bookAs({ ...salas(), date: d, time: "12:15" });
    expect(ok.status).toBe("pending");
  });

  it("rechaza citas que invaden el descanso del horario partido o el final de la jornada", async () => {
    const d = await day(2);
    expect(await bookError({ ...salas(), date: d, time: "12:45" })).toBe("outside_schedule"); // cruza 13:00–15:00
    expect(await bookError({ ...ruiz(), date: d, time: "14:45" })).toBe("outside_schedule");
    expect(await bookError({ ...ruiz(), date: d, time: "17:45" })).toBe("outside_schedule"); // termina 18:15
    expect(await bookError({ ...ruiz(), date: d, time: "08:30" })).toBe("outside_schedule");
    expect((await bookAs({ ...ruiz(), date: d, time: "15:00" })).status).toBe("pending");
    expect((await bookAs({ ...ruiz(), date: d, time: "17:30" })).status).toBe("pending");
  });

  it("rechaza días sin horario (sábado y domingo)", async () => {
    const saturday = await futureWeekday(db, TZ, 2, 6);
    expect(await bookError({ ...ruiz(), date: saturday, time: "10:00" })).toBe("outside_schedule");
  });

  it("respeta los bloqueos y su límite final", async () => {
    const d = await day(3);
    await db.as(f.users.clinicAdmin, (s) =>
      s.query(
        `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind, note)
         values ($1, $2, ($3::date + time '11:00') at time zone $4, ($3::date + time '12:00') at time zone $4, 'meal', 'Comida')`,
        [f.clinicId, f.clinic.ruizId, d, TZ],
      ),
    );
    expect(await bookError({ ...ruiz(), date: d, time: "11:30" })).toBe("blocked");
    expect(await bookError({ ...ruiz(), date: d, time: "10:45" })).toBe("blocked"); // invade 11:00–11:15
    expect((await bookAs({ ...ruiz(), date: d, time: "10:30" })).status).toBe("pending"); // termina 11:00
    expect((await bookAs({ ...ruiz(), date: d, time: "12:00" })).status).toBe("pending");
    // Recepción ve el bloqueo al agendar.
    const blocks = await db.as(f.users.reception, (s) =>
      s.query<{ local_start: string; kind: string }>(`select * from public.agenda_time_off($1, $2::date, $2::date)`, [f.clinicId, d]),
    );
    expect(blocks.map((b) => [b.local_start, b.kind])).toEqual([[`${d}T11:00`, "meal"]]);
  });

  it("dos profesionales distintos pueden atender a la misma hora", async () => {
    const d = await day(4);
    await bookAs({ ...ruiz(), date: d, time: "09:00" });
    await bookAs({ ...salas(), date: d, time: "09:00" });
  });

  it("no permite agendar en el pasado, con servicio no asignado ni con profesional desactivado", async () => {
    const yesterday = await db.one<{ d: string }>(`select to_char((now() at time zone $1)::date - 1, 'YYYY-MM-DD') as d`, [TZ]);
    expect(await bookError({ ...ruiz(), date: yesterday.d, time: "10:00" })).toBe("appointment_in_past");
    const d = await day(5);
    expect(await bookError({ ...ruiz(), serviceId: f.clinic.limpiezaId, date: d, time: "10:00" })).toBe("service_not_offered");

    const kept = await bookAs({ ...salas(), date: d, time: "10:00" });
    await db.as(f.users.clinicAdmin, (s) => s.query(`update public.professionals set active = false where id = $1`, [f.clinic.salasId]));
    const pending = await db.as(f.users.clinicAdmin, (s) =>
      s.one<{ n: number }>(`select public.professional_future_appointments($1) as n`, [f.clinic.salasId]),
    );
    expect(pending.n).toBeGreaterThan(0); // la interfaz avisa; nada se cancela en silencio
    expect(await bookError({ ...salas(), date: d, time: "16:00" })).toBe("professional_inactive");
    const still = await db.one<{ status: string }>(`select status from public.appointments where id = $1`, [kept.id]);
    expect(still.status).toBe("pending");
    const deactivated = await db.one<{ deactivated_at: Date | null }>(`select deactivated_at from public.professionals where id = $1`, [f.clinic.salasId]);
    expect(deactivated.deactivated_at).not.toBeNull();
    await db.as(f.users.clinicAdmin, (s) => s.query(`update public.professionals set active = true where id = $1`, [f.clinic.salasId]));
  });

  it("calcula la hora final en el servidor y la conserva si cambia la duración del servicio", async () => {
    const d = await day(6);
    // El cliente intenta mandar una hora final arbitraria: se ignora.
    const appt = await db.as(f.users.reception, (s) =>
      s.one<{ id: string; ends_at: Date; starts_at: Date }>(
        `insert into public.appointments (organization_id, professional_id, service_id, contact_id, starts_at, ends_at)
         values ($1, $2, $3, $4, ($5::date + time '16:00') at time zone $6, ($5::date + time '16:05') at time zone $6)
         returning id, starts_at, ends_at`,
        [f.clinicId, f.clinic.salasId, f.clinic.limpiezaId, f.clinic.patientId, d, TZ],
      ),
    );
    expect((new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60000).toBe(45);
    await db.as(f.users.clinicAdmin, (s) => s.query(`update public.services set duration_minutes = 60 where id = $1`, [f.clinic.limpiezaId]));
    const after = await db.one<{ ends_at: Date }>(`select ends_at from public.appointments where id = $1`, [appt.id]);
    expect(new Date(after.ends_at).getTime()).toBe(new Date(appt.ends_at).getTime());
    const next = await bookAs({ ...salas(), date: d, time: "16:45" });
    expect((new Date(next.ends_at).getTime() - new Date(next.starts_at).getTime()) / 60000).toBe(60);
    await db.as(f.users.clinicAdmin, (s) => s.query(`update public.services set duration_minutes = 45 where id = $1`, [f.clinic.limpiezaId]));
  });

  it("los horarios semanales no admiten bloques traslapados el mismo día", async () => {
    const error = await expectPgError(
      db.as(f.users.clinicAdmin, (s) =>
        s.query(`select public.set_weekly_schedule($1, $2::jsonb)`, [
          f.clinic.salasId,
          JSON.stringify([
            { weekday: 1, start_time: "09:00", end_time: "13:00" },
            { weekday: 1, start_time: "12:00", end_time: "14:00" },
          ]),
        ]),
      ),
    );
    expect(error.code).toBe("23P01");
    // El horario anterior sigue intacto (transacción revertida).
    const rules = await db.sql(`select * from public.availability_rules where professional_id = $1`, [f.clinic.salasId]);
    expect(rules).toHaveLength(10);
  });
});

describe("horarios disponibles", () => {
  it("excluye citas, bloqueos, descansos y el final de la jornada", async () => {
    const d = await day(7);
    await bookAs({ ...ruiz(), date: d, time: "10:00" });
    await db.as(f.users.clinicAdmin, (s) =>
      s.query(
        `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind)
         values ($1, $2, ($3::date + time '11:00') at time zone $4, ($3::date + time '12:00') at time zone $4, 'absence')`,
        [f.clinicId, f.clinic.ruizId, d, TZ],
      ),
    );
    const slots = await db.as(f.users.reception, (s) =>
      s.query<{ local_start: string }>(`select local_start from public.get_available_slots($1, $2, $3::date)`, [
        f.clinic.ruizId,
        f.clinic.consultaId,
        d,
      ]),
    );
    const times = slots.map((x) => x.local_start.slice(11));
    expect(times).toEqual([
      "09:00", "09:15", "09:30",
      "10:30",
      "12:00", "12:15", "12:30",
      "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45", "17:00", "17:15", "17:30",
    ]);
  });

  it("al reprogramar ignora la propia cita", async () => {
    const d = await day(8);
    const appt = await bookAs({ ...ruiz(), date: d, time: "09:00" });
    const slots = await db.as(f.users.reception, (s) =>
      s.query<{ local_start: string }>(`select local_start from public.get_available_slots($1, $2, $3::date, 1, $4)`, [
        f.clinic.ruizId,
        f.clinic.consultaId,
        d,
        appt.id,
      ]),
    );
    expect(slots[0].local_start).toBe(`${d}T09:00`);
  });
});

describe("estados y reprogramación", () => {
  it("cancelar conserva el registro y el historial, y libera el horario", async () => {
    const d = await day(9);
    const appt = await bookAs({ ...ruiz(), date: d, time: "16:00" });
    await db.as(f.users.reception, (s) => s.query(`select public.set_appointment_status($1, 'cancelled', 'Lo pidió el paciente')`, [appt.id]));
    const row = await db.one<{ status: string; cancellation_reason: string }>(
      `select status, cancellation_reason from public.appointments where id = $1`,
      [appt.id],
    );
    expect(row).toEqual({ status: "cancelled", cancellation_reason: "Lo pidió el paciente" });
    const events = await db.sql<{ event_type: string; from_status: string; to_status: string; actor_id: string }>(
      `select event_type, from_status, to_status, actor_id from public.appointment_events where appointment_id = $1 order by id`,
      [appt.id],
    );
    expect(events).toEqual([
      { event_type: "created", from_status: null, to_status: "pending", actor_id: f.users.reception.id },
      { event_type: "status_changed", from_status: "pending", to_status: "cancelled", actor_id: f.users.reception.id },
    ]);
    const again = await bookAs({ ...ruiz(), date: d, time: "16:00" });
    expect(again.id).not.toBe(appt.id);
    // Una cancelada no se reactiva.
    const reopen = await expectPgError(db.as(f.users.reception, (s) => s.query(`select public.set_appointment_status($1, 'confirmed')`, [appt.id])));
    expect(reopen.message).toBe("invalid_status_transition");
  });

  it("mover a un horario ocupado conserva la reserva original; mover a uno libre conserva la misma cita", async () => {
    const d = await day(10);
    await bookAs({ ...ruiz(), date: d, time: "15:00" });
    const b = await bookAs({ ...ruiz(), date: d, time: "15:30" });

    const error = await expectPgError(
      db.as(f.users.reception, (s) => s.query(`select public.reschedule_appointment($1, $2::date, '15:00')`, [b.id, d])),
    );
    expect(error.message).toBe("slot_taken");
    const unchanged = await db.one<{ starts_at: Date; status: string }>(`select starts_at, status from public.appointments where id = $1`, [b.id]);
    expect(new Date(unchanged.starts_at).getTime()).toBe(new Date(b.starts_at).getTime());
    expect(unchanged.status).toBe("pending");

    const moved = await db.as(f.users.reception, (s) =>
      s.one<{ id: string; local: string }>(
        `select r.id, to_char(r.starts_at at time zone $3, 'HH24:MI') as local from public.reschedule_appointment($1, $2::date, '16:30') r`,
        [b.id, d, TZ],
      ),
    );
    expect(moved).toEqual({ id: b.id, local: "16:30" });
    const events = await db.sql<{ event_type: string; from_starts_at: Date; to_starts_at: Date }>(
      `select event_type, from_starts_at, to_starts_at from public.appointment_events where appointment_id = $1 order by id`,
      [b.id],
    );
    expect(events.map((e) => e.event_type)).toEqual(["created", "rescheduled"]);
    expect(new Date(events[1].from_starts_at).getTime()).toBe(new Date(b.starts_at).getTime());
    // Recepción también puede pasar la cita a otro profesional que ofrece el servicio.
    const other = await db.as(f.users.reception, (s) =>
      s.one<{ professional_id: string }>(`select professional_id from public.reschedule_appointment($1, $2::date, '10:00', $3)`, [
        b.id,
        d,
        f.clinic.salasId,
      ]),
    );
    expect(other.professional_id).toBe(f.clinic.salasId);
    // …pero no a uno que no lo ofrece: la cita se queda donde estaba.
    const svcOnlyRuiz = await db.as(f.users.clinicAdmin, async (s) => {
      const svc = await s.one<{ id: string }>(
        `insert into public.services (organization_id, name, duration_minutes) values ($1, 'Certificado médico', 15) returning id`,
        [f.clinicId],
      );
      await s.query(`insert into public.professional_services (organization_id, professional_id, service_id) values ($1, $2, $3)`, [
        f.clinicId,
        f.clinic.ruizId,
        svc.id,
      ]);
      return svc.id;
    });
    const cert = await bookAs({ ...ruiz(), serviceId: svcOnlyRuiz, date: d, time: "12:00" });
    const wrong = await expectPgError(
      db.as(f.users.reception, (s) => s.query(`select public.reschedule_appointment($1, $2::date, '11:00', $3)`, [cert.id, d, f.clinic.salasId])),
    );
    expect(wrong.message).toBe("service_not_offered");
    const stays = await db.one<{ professional_id: string }>(`select professional_id from public.appointments where id = $1`, [cert.id]);
    expect(stays.professional_id).toBe(f.clinic.ruizId);
  });

  it("no se puede marcar como atendida o no asistió una cita futura; sí una que ya comenzó", async () => {
    const d = await day(11);
    const future = await bookAs({ ...ruiz(), date: d, time: "09:30" });
    for (const status of ["attended", "no_show"]) {
      const error = await expectPgError(db.as(f.users.reception, (s) => s.query(`select public.set_appointment_status($1, $2)`, [future.id, status])));
      expect(error.message).toBe("appointment_not_started");
    }

    // Una cita pasada (cargada como lo hace el seed) sí puede cerrarse.
    const past = await db.one<{ d: string }>(
      `select to_char(d, 'YYYY-MM-DD') as d from generate_series((now() at time zone $1)::date - 7, (now() at time zone $1)::date - 1, interval '1 day') d
       where extract(isodow from d) between 1 and 5 order by d desc limit 1`,
      [TZ],
    );
    const pastAppt = await db.one<{ id: string }>(
      `insert into public.appointments (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status)
       values ($1, $2, $3, $4, ($5::date + time '10:00') at time zone $6, ($5::date + time '10:30') at time zone $6, 'confirmed') returning id`,
      [f.clinicId, f.clinic.ruizId, f.clinic.consultaId, f.clinic.patientId, past.d, TZ],
    );
    await db.as(f.users.drRuiz, (s) => s.query(`select public.set_appointment_status($1, 'attended')`, [pastAppt.id]));
    // Corrección permitida entre estados cerrados.
    await db.as(f.users.drRuiz, (s) => s.query(`select public.set_appointment_status($1, 'no_show')`, [pastAppt.id]));
    const moveClosed = await expectPgError(
      db.as(f.users.reception, (s) => s.query(`select public.reschedule_appointment($1, $2::date, '10:00')`, [pastAppt.id, d])),
    );
    expect(moveClosed.message).toBe("appointment_closed");
    // Las citas nuevas solo nacen pendientes o confirmadas.
    const bad = await expectPgError(bookAs({ ...ruiz(), date: d, time: "12:00", status: "attended" }));
    expect(bad.message).toBe("invalid_initial_status");
  });

  it("no permite crear un bloqueo encima de citas vigentes hasta resolverlas", async () => {
    const d = await day(12);
    const appt = await bookAs({ ...ruiz(), date: d, time: "10:00" });
    const insertBlock = () =>
      db.as(f.users.clinicAdmin, (s) =>
        s.query(
          `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind)
           values ($1, $2, ($3::date + time '09:00') at time zone $4, ($3::date + time '13:00') at time zone $4, 'vacation')`,
          [f.clinicId, f.clinic.ruizId, d, TZ],
        ),
      );
    const error = await expectPgError(insertBlock());
    expect(error.message).toBe("time_off_conflict");
    expect(error.detail).toBe("1");
    await db.as(f.users.reception, (s) => s.query(`select public.set_appointment_status($1, 'cancelled')`, [appt.id]));
    await insertBlock();
  });

  it("evita duplicados por doble clic con la llave de idempotencia", async () => {
    const d = await day(13);
    const key = "6f9d7a52-2a33-4c4e-9f53-0c4b1d1e6a11";
    const first = await bookAs({ ...ruiz(), date: d, time: "11:00", key });
    const second = await bookAs({ ...ruiz(), date: d, time: "11:00", key });
    expect(second.id).toBe(first.id);
    const rows = await db.sql(`select id from public.appointments where idempotency_key = $1`, [key]);
    expect(rows).toHaveLength(1);
  });
});

describe("zona horaria del espacio", () => {
  it("guarda el instante correcto y muestra la hora local aunque la sesión use otra zona", async () => {
    const d = await day(14);
    const appt = await bookAs({ ...ruiz(), date: d, time: "10:00" });
    // Ciudad de México no tiene horario de verano desde 2022: UTC-6.
    expect(new Date(appt.starts_at).toISOString()).toBe(`${d}T16:00:00.000Z`);
    const client = await db.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local timezone = 'Asia/Tokyo'");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.reception.id })]);
      const rows = (
        await client.query(`select local_start, local_end from public.agenda_appointments($1, $2::date, $2::date) where id = $3`, [
          f.clinicId,
          d,
          appt.id,
        ])
      ).rows;
      expect(rows).toEqual([{ local_start: `${d}T10:00`, local_end: `${d}T10:30` }]);
      const slots = (
        await client.query(`select local_start from public.get_available_slots($1, $2, $3::date) limit 1`, [f.clinic.ruizId, f.clinic.consultaId, d])
      ).rows;
      expect(slots[0].local_start).toBe(`${d}T09:00`);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("los horarios semanales son horas locales de cada espacio (zona con horario de verano)", async () => {
    const owner = await db.createUser("tijuana@consultorio.test");
    await db.as(owner, async (s) => {
      const org = (await s.one<{ id: string }>(`select public.create_organization('Consultorio Tijuana', 'independent', 'America/Tijuana', true) as id`)).id;
      const prof = (await s.one<{ id: string }>(`select id from public.professionals where organization_id = $1`, [org])).id;
      const svc = (await s.one<{ id: string }>(`insert into public.services (organization_id, name, duration_minutes) values ($1, 'Consulta', 30) returning id`, [org])).id;
      await s.query(`insert into public.professional_services (organization_id, professional_id, service_id) values ($1, $2, $3)`, [org, prof, svc]);
      await s.query(`select public.set_weekly_schedule($1, '[{"weekday":3,"start_time":"09:00","end_time":"12:00"}]'::jsonb)`, [prof]);
      const contact = (await s.one<{ id: string }>(`insert into public.contacts (organization_id, full_name, phone) values ($1, 'Paciente TJ', '6641234567') returning id`, [org])).id;
      const d = await futureWeekday(db, "America/Tijuana", 2, 3);
      const offset = await db.one<{ h: number }>(
        `select extract(epoch from (($1::date + time '09:00') at time zone 'UTC') - (($1::date + time '09:00') at time zone 'America/Tijuana')) / 3600 as h`,
        [d],
      );
      const appt = await book(s, { professionalId: prof, serviceId: svc, contactId: contact, date: d, time: "09:00" });
      const utcHour = new Date(appt.starts_at).getUTCHours();
      expect(utcHour).toBe((9 - Number(offset.h) + 24) % 24);
      expect([16, 17]).toContain(utcHour); // PDT (UTC-7) o PST (UTC-8)
    });
  });
});
