// Escenarios 4 y 5: permisos por rol y cuentas con varios espacios.
import { beforeAll, describe, expect, it } from "vitest";
import { book, buildFixture, expectPgError, type Fixture, freshDatabase, type TestDb, waitForLockWaiters } from "./helpers";

let db: TestDb;
let f: Fixture;
let salasPatientId: string;
let ruizApptId: string;
let salasApptId: string;

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
  // Recepción agenda con ambos profesionales; el paciente de Salas solo tiene citas con Salas.
  await db.as(f.users.reception, async (s) => {
    salasPatientId = (
      await s.one<{ id: string }>(
        `insert into public.contacts (organization_id, full_name, phone) values ($1, 'Paciente de Salas', '5511112222') returning id`,
        [f.clinicId],
      )
    ).id;
    ruizApptId = (
      await book(s, { professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: f.clinic.patientId, date: f.day, time: "09:00" })
    ).id;
    salasApptId = (
      await book(s, { professionalId: f.clinic.salasId, serviceId: f.clinic.limpiezaId, contactId: salasPatientId, date: f.day, time: "09:00" })
    ).id;
  });
});

describe("Recepción", () => {
  it("trabaja con todos los profesionales, pacientes y citas de su clínica", async () => {
    await db.as(f.users.reception, async (s) => {
      expect(await s.query(`select id from public.professionals where organization_id = $1`, [f.clinicId])).toHaveLength(2);
      expect(await s.query(`select id from public.contacts where organization_id = $1`, [f.clinicId])).toHaveLength(2);
      expect(await s.query(`select * from public.agenda_appointments($1, $2::date, $2::date)`, [f.clinicId, f.day])).toHaveLength(2);
      expect(await s.query(`select * from public.availability_rules where organization_id = $1`, [f.clinicId])).not.toHaveLength(0);
      const slots = await s.query(`select * from public.get_available_slots($1, $2, $3::date)`, [f.clinic.salasId, f.clinic.limpiezaId, f.day]);
      expect(slots.length).toBeGreaterThan(0);
      await s.query(`select public.set_appointment_status($1, 'confirmed')`, [salasApptId]);
    });
  });

  it("no administra membresías, invitaciones, profesionales, horarios ni bloqueos", async () => {
    await db.as(f.users.reception, async (s) => {
      expect(await s.query(`update public.memberships set role = 'reception' where organization_id = $1 returning id`, [f.clinicId])).toHaveLength(0);
      expect(await s.query(`select * from public.memberships where organization_id = $1`, [f.clinicId])).toHaveLength(1); // solo la suya
      expect(await s.query(`update public.professionals set active = false where id = $1 returning id`, [f.clinic.salasId])).toHaveLength(0);
      expect(await s.query(`update public.services set duration_minutes = 5 where organization_id = $1 returning id`, [f.clinicId])).toHaveLength(0);
    });
    for (const sql of [
      `select * from public.create_invitation('${f.clinicId}', 'otra@clinica.test', 'admin')`,
      `select public.set_weekly_schedule('${f.clinic.salasId}', '[]'::jsonb)`,
      `insert into public.time_off (organization_id, professional_id, starts_at, ends_at) values ('${f.clinicId}', '${f.clinic.salasId}', now() + interval '20 days', now() + interval '21 days')`,
      `insert into public.professionals (organization_id, display_name) values ('${f.clinicId}', 'Nuevo')`,
    ]) {
      const error = await expectPgError(db.as(f.users.reception, (s) => s.query(sql)));
      expect(error.code, sql).toBe("42501");
    }
  });
});

describe("Profesional con cuenta", () => {
  it("solo ve su propio perfil, horarios, citas y pacientes vinculados", async () => {
    await db.as(f.users.drRuiz, async (s) => {
      const professionals = await s.query<{ id: string }>(`select id from public.professionals`);
      expect(professionals.map((p) => p.id)).toEqual([f.clinic.ruizId]);
      const agenda = await s.query<{ id: string }>(`select id from public.agenda_appointments($1, $2::date, $2::date)`, [f.clinicId, f.day]);
      expect(agenda.map((a) => a.id)).toEqual([ruizApptId]);
      // Cambiar el filtro a otro profesional no revela nada.
      expect(
        await s.query(`select * from public.agenda_appointments($1, $2::date, $2::date, $3)`, [f.clinicId, f.day, f.clinic.salasId]),
      ).toHaveLength(0);
      expect(await s.query(`select * from public.appointments where id = $1`, [salasApptId])).toHaveLength(0);
      expect(await s.query(`select * from public.availability_rules where professional_id = $1`, [f.clinic.salasId])).toHaveLength(0);
      expect(await s.query(`select * from public.time_off where professional_id = $1`, [f.clinic.salasId])).toHaveLength(0);
      const contacts = await s.query<{ id: string }>(`select id from public.contacts`);
      expect(contacts.map((c) => c.id)).toEqual([f.clinic.patientId]);
      expect(await s.query(`select * from public.contacts where id = $1`, [salasPatientId])).toHaveLength(0);
      expect(await s.query(`select * from public.search_contacts($1, 'Salas')`, [f.clinicId])).toHaveLength(0);
      expect(await s.query(`select * from public.find_similar_contacts($1, 'Paciente de Salas', '5511112222')`, [f.clinicId])).toHaveLength(0);
      expect(await s.query(`select * from public.appointment_events where appointment_id = $1`, [salasApptId])).toHaveLength(0);
    });
  });

  it("administra su propio horario y bloqueos, pero no los de otro profesional", async () => {
    // Bloqueo ajeno creado por administración, para intentar borrarlo.
    const salasBlock = await db.as(f.users.clinicAdmin, (s) =>
      s.one<{ id: string }>(
        `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind)
         values ($1, $2, now() + interval '40 days', now() + interval '41 days', 'vacation') returning id`,
        [f.clinicId, f.clinic.salasId],
      ),
    );

    await db.as(f.users.drRuiz, async (s) => {
      // Su horario: lo reescribe con las mismas reglas (no altera el resto de las pruebas).
      const current = await s.one<{ rules: unknown }>(
        `select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start_time', start_time, 'end_time', end_time)), '[]') as rules
         from public.availability_rules where professional_id = $1`,
        [f.clinic.ruizId],
      );
      await s.query(`select public.set_weekly_schedule($1, $2::jsonb)`, [f.clinic.ruizId, JSON.stringify(current.rules)]);

      // Sus vacaciones: las crea y las quita.
      const own = await s.one<{ id: string }>(
        `insert into public.time_off (organization_id, professional_id, starts_at, ends_at, kind)
         values ($1, $2, now() + interval '40 days', now() + interval '42 days', 'vacation') returning id`,
        [f.clinicId, f.clinic.ruizId],
      );
      expect(await s.query(`delete from public.time_off where id = $1 returning id`, [own.id])).toHaveLength(1);

      // El bloqueo ajeno no existe para su cuenta.
      expect(await s.query(`delete from public.time_off where id = $1 returning id`, [salasBlock.id])).toHaveLength(0);
    });

    for (const sql of [
      `select public.set_weekly_schedule('${f.clinic.salasId}', '[]'::jsonb)`,
      `insert into public.time_off (organization_id, professional_id, starts_at, ends_at) values ('${f.clinicId}', '${f.clinic.salasId}', now() + interval '50 days', now() + interval '51 days')`,
      `insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time) values ('${f.clinicId}', '${f.clinic.salasId}', 7, '09:00', '10:00')`,
    ]) {
      const error = await expectPgError(db.as(f.users.drRuiz, (s) => s.query(sql)));
      expect(error.code, sql).toBe("42501");
    }
    // Ni a su nombre en un espacio ajeno.
    const crossOrg = await expectPgError(
      db.as(f.users.drRuiz, (s) =>
        s.query(
          `insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time) values ($1, $2, 7, '09:00', '10:00')`,
          [f.indepId, f.clinic.ruizId],
        ),
      ),
    );
    expect(["42501", "P0001"]).toContain(crossOrg.code);
  });

  it("no puede consultar disponibilidad ni agendar para otro profesional", async () => {
    const slots = await expectPgError(
      db.as(f.users.drRuiz, (s) => s.query(`select * from public.get_available_slots($1, $2, $3::date)`, [f.clinic.salasId, f.clinic.limpiezaId, f.day])),
    );
    expect(slots.message).toBe("forbidden");
    const booking = await expectPgError(
      db.as(f.users.drRuiz, (s) =>
        book(s, { professionalId: f.clinic.salasId, serviceId: f.clinic.limpiezaId, contactId: f.clinic.patientId, date: f.day, time: "11:00" }),
      ),
    );
    expect(booking.message).toBe("professional_not_found");
    // Ni moviendo su cita a la agenda de otro profesional.
    const move = await expectPgError(
      db.as(f.users.drRuiz, (s) => s.query(`select public.reschedule_appointment($1, $2::date, '11:00', $3)`, [ruizApptId, f.day, f.clinic.salasId])),
    );
    expect(move.code).toBe("42501");
    // Ni modificando una cita ajena.
    const touched = await db.as(f.users.drRuiz, (s) => s.query(`update public.appointments set notes = 'x' where id = $1 returning id`, [salasApptId]));
    expect(touched).toHaveLength(0);
  });

  it("agenda en su propia agenda con un paciente nuevo, pero no con pacientes ajenos", async () => {
    const denied = await expectPgError(
      db.as(f.users.drRuiz, (s) =>
        book(s, { professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: salasPatientId, date: f.day, time: "11:00" }),
      ),
    );
    expect(denied.message).toBe("contact_not_accessible");

    await db.as(f.users.drRuiz, async (s) => {
      const contact = await s.one<{ id: string }>(
        `insert into public.contacts (organization_id, full_name, email) values ($1, 'Nuevo paciente de Ruiz', 'nuevo@correo.test') returning id`,
        [f.clinicId],
      );
      const appt = await book(s, { professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: contact.id, date: f.day, time: "11:00" });
      expect(appt.status).toBe("pending");
      await s.query(`select public.set_appointment_status($1, 'confirmed')`, [appt.id]);
    });
  });
});

describe("Cuenta con varios espacios", () => {
  it("ve solo los datos y acciones del espacio y rol correspondientes", async () => {
    // La recepcionista de la clínica también administra un consultorio de nutrición propio.
    const nutriId = await db.as(f.users.reception, async (s) =>
      (await s.one<{ id: string }>(`select public.create_organization('Centro de Nutrición Vital', 'independent') as id`)).id,
    );
    await db.as(f.users.reception, async (s) => {
      const memberships = await s.query<{ organization_id: string; role: string }>(
        `select organization_id, role from public.memberships order by role`,
      );
      expect(memberships).toEqual([
        { organization_id: nutriId, role: "admin" },
        { organization_id: f.clinicId, role: "reception" },
      ]);
      // En el consultorio de nutrición administra; en la clínica no.
      await s.query(`insert into public.professionals (organization_id, display_name, professional_type) values ($1, 'Lic. Daniela Soto', 'nutriologo')`, [nutriId]);
      expect(await s.query(`select * from public.professionals where organization_id = $1`, [nutriId])).toHaveLength(1);
      expect(await s.query(`select * from public.contacts where organization_id = $1`, [nutriId])).toHaveLength(0);
      const clinicContacts = await db.one<{ n: number }>(`select count(*)::int as n from public.contacts where organization_id = $1`, [f.clinicId]);
      expect(await s.query(`select * from public.contacts where organization_id = $1`, [f.clinicId])).toHaveLength(clinicContacts.n);
    });
    const error = await expectPgError(
      db.as(f.users.reception, (s) =>
        s.query(`insert into public.professionals (organization_id, display_name) values ($1, 'Intento en clínica')`, [f.clinicId]),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("una membresía revocada deja de dar acceso en la siguiente consulta", async () => {
    const temp = await db.createUser("temporal@clinica.test");
    const token = await db.as(f.users.clinicAdmin, async (s) =>
      (await s.one<{ token: string }>(`select token from public.create_invitation($1, $2, 'reception')`, [f.clinicId, temp.email])).token,
    );
    await db.as(temp, (s) => s.query(`select public.accept_invitation($1)`, [token]));
    expect(await db.as(temp, (s) => s.query(`select id from public.contacts where organization_id = $1`, [f.clinicId]))).not.toHaveLength(0);
    await db.as(f.users.clinicAdmin, (s) => s.query(`delete from public.memberships where user_id = $1 and organization_id = $2`, [temp.id, f.clinicId]));
    expect(await db.as(temp, (s) => s.query(`select id from public.contacts where organization_id = $1`, [f.clinicId]))).toHaveLength(0);
    expect(await db.as(temp, (s) => s.query(`select id from public.organizations`))).toHaveLength(0);
  });
});

describe("Administración", () => {
  it("un administrador que también atiende recibe y gestiona sus citas con una sola cuenta", async () => {
    await db.as(f.users.drHerrera, async (s) => {
      const appt = await book(s, {
        professionalId: f.indep.professionalId,
        serviceId: f.indep.serviceId,
        contactId: f.indep.patientId,
        date: f.day,
        time: "10:00",
        status: "confirmed",
      });
      expect(appt.status).toBe("confirmed");
      const own = await s.one<{ user_id: string }>(`select user_id from public.professionals where id = $1`, [f.indep.professionalId]);
      expect(own.user_id).toBe(f.users.drHerrera.id);
    });
  });

  it("el espacio nunca se queda sin administrador", async () => {
    const demote = await expectPgError(
      db.as(f.users.drHerrera, (s) => s.query(`update public.memberships set role = 'professional' where user_id = $1`, [f.users.drHerrera.id])),
    );
    expect(demote.message).toBe("last_admin");
    const leave = await expectPgError(
      db.as(f.users.drHerrera, (s) => s.query(`delete from public.memberships where user_id = $1`, [f.users.drHerrera.id])),
    );
    expect(leave.message).toBe("last_admin");
  });

  it("dos administradores que se degradan mutuamente al mismo tiempo no dejan el espacio sin admin", async () => {
    const second = await db.createUser("segunda.admin@clinica.test");
    const token = await db.as(f.users.clinicAdmin, async (s) =>
      (await s.one<{ token: string }>(`select token from public.create_invitation($1, $2, 'admin')`, [f.clinicId, second.email])).token,
    );
    await db.as(second, (s) => s.query(`select public.accept_invitation($1)`, [token]));

    const a = await db.open(f.users.clinicAdmin);
    const b = await db.open(second);
    try {
      await a.query(`update public.memberships set role = 'reception' where user_id = $1 and organization_id = $2`, [second.id, f.clinicId]);
      const pendingB = b.query(`update public.memberships set role = 'reception' where user_id = $1 and organization_id = $2`, [
        f.users.clinicAdmin.id,
        f.clinicId,
      ]);
      pendingB.catch(() => {});
      await waitForLockWaiters(db);
      await a.commit();
      const error = await expectPgError(pendingB);
      expect(error.message).toBe("last_admin");
    } finally {
      await b.rollback();
      a.release();
      b.release();
    }
    const admins = await db.sql(`select user_id from public.memberships where organization_id = $1 and role = 'admin'`, [f.clinicId]);
    expect(admins).toHaveLength(1);
  });
});
