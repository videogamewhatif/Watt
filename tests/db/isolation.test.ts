// Escenario 3: aislamiento entre espacios de trabajo (RLS + llaves foráneas compuestas).
import { beforeAll, describe, expect, it } from "vitest";
import { book, buildFixture, expectPgError, type Fixture, freshDatabase, type TestDb } from "./helpers";

let db: TestDb;
let f: Fixture;

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
  await db.as(f.users.drHerrera, (s) =>
    book(s, {
      professionalId: f.indep.professionalId,
      serviceId: f.indep.serviceId,
      contactId: f.indep.patientId,
      date: f.day,
      time: "09:00",
    }),
  );
});

describe("el administrador de la clínica frente al consultorio independiente", () => {
  it("no puede leer ninguna tabla del otro espacio aunque filtre por su id", async () => {
    await db.as(f.users.clinicAdmin, async (s) => {
      const tables = [
        "organizations",
        "memberships",
        "invitations",
        "professionals",
        "services",
        "professional_services",
        "availability_rules",
        "time_off",
        "contacts",
        "appointments",
        "appointment_events",
      ];
      for (const table of tables) {
        const column = table === "organizations" ? "id" : "organization_id";
        const rows = await s.query(`select * from public.${table} where ${column} = $1`, [f.indepId]);
        expect(rows, table).toHaveLength(0);
      }
      // Ni siquiera por id directo (equivale a abrir /pacientes/<id> de otro espacio).
      expect(await s.query(`select * from public.contacts where id = $1`, [f.indep.patientId])).toHaveLength(0);
      expect(await s.query(`select * from public.profiles where id = $1`, [f.users.drHerrera.id])).toHaveLength(0);
    });
  });

  it("no puede modificar datos del otro espacio (0 filas afectadas)", async () => {
    await db.as(f.users.clinicAdmin, async (s) => {
      expect(await s.query(`update public.organizations set name = 'Hackeado' where id = $1 returning id`, [f.indepId])).toHaveLength(0);
      expect(
        await s.query(`update public.professionals set display_name = 'X' where id = $1 returning id`, [f.indep.professionalId]),
      ).toHaveLength(0);
      expect(await s.query(`update public.contacts set full_name = 'X' where id = $1 returning id`, [f.indep.patientId])).toHaveLength(0);
      expect(await s.query(`update public.appointments set status = 'cancelled' where organization_id = $1 returning id`, [f.indepId])).toHaveLength(0);
      expect(await s.query(`delete from public.memberships where organization_id = $1 returning id`, [f.indepId])).toHaveLength(0);
    });
    const org = await db.one<{ name: string }>(`select name from public.organizations where id = $1`, [f.indepId]);
    expect(org.name).toBe("Consultorio Dr. Herrera");
  });

  it("no puede insertar registros en el otro espacio", async () => {
    const e1 = await expectPgError(
      db.as(f.users.clinicAdmin, (s) =>
        s.query(`insert into public.professionals (organization_id, display_name) values ($1, 'Intruso')`, [f.indepId]),
      ),
    );
    expect(e1.code).toBe("42501");
    const e2 = await expectPgError(
      db.as(f.users.clinicAdmin, (s) =>
        s.query(`insert into public.contacts (organization_id, full_name, phone) values ($1, 'Intruso', '5550000000')`, [f.indepId]),
      ),
    );
    expect(e2.code).toBe("42501");
  });

  it("las RPC también rechazan el acceso al otro espacio", async () => {
    await db.as(f.users.clinicAdmin, async (s) => {
      expect(await s.query(`select * from public.agenda_appointments($1, $2::date, $2::date)`, [f.indepId, f.day])).toHaveLength(0);
      expect(await s.query(`select * from public.search_contacts($1, '')`, [f.indepId])).toHaveLength(0);
    });
    const cases: Array<[string, unknown[]]> = [
      [`select * from public.get_available_slots($1, $2, $3::date)`, [f.indep.professionalId, f.indep.serviceId, f.day]],
      [`select public.dashboard_summary($1)`, [f.indepId]],
      [`select public.set_weekly_schedule($1, '[]'::jsonb)`, [f.indep.professionalId]],
      [`select * from public.create_invitation($1, 'x@x.test', 'admin')`, [f.indepId]],
      [
        `select * from public.book_appointment($1, $2, $3, $4::date, '10:00'::time)`,
        [f.indep.professionalId, f.indep.serviceId, f.indep.patientId, f.day],
      ],
    ];
    for (const [sql, params] of cases) {
      const error = await expectPgError(db.as(f.users.clinicAdmin, (s) => s.query(sql, params)));
      expect(["42501", "P0001"], `${sql} -> ${error.code} ${error.message}`).toContain(error.code);
      expect(["forbidden", "professional_not_found"]).toContain(error.message);
    }
  });

  it("no puede mezclar su organización con entidades ajenas al agendar", async () => {
    // Cita en la clínica pero con paciente del consultorio.
    const error = await expectPgError(
      db.as(f.users.clinicAdmin, (s) =>
        book(s, { professionalId: f.clinic.ruizId, serviceId: f.clinic.consultaId, contactId: f.indep.patientId, date: f.day, time: "09:00" }),
      ),
    );
    expect(error.code).toBe("23503");
  });
});

describe("la base rechaza relaciones entre espacios aunque se salte la aplicación", () => {
  it("cita con profesional, servicio o contacto de otro espacio", async () => {
    const base = {
      org: f.clinicId,
      prof: f.clinic.ruizId,
      service: f.clinic.consultaId,
      contact: f.clinic.patientId,
    };
    const variants = [
      { v: { ...base, prof: f.indep.professionalId }, expected: "professional_not_found" },
      { v: { ...base, service: f.indep.serviceId }, expected: "service_not_found" },
      { v: { ...base, contact: f.indep.patientId }, expected: "23503" },
    ];
    for (const { v, expected } of variants) {
      const error = await expectPgError(
        db.sql(
          `insert into public.appointments (organization_id, professional_id, service_id, contact_id, starts_at, ends_at)
           values ($1, $2, $3, $4, ($5::date + time '11:00') at time zone 'America/Mexico_City',
                   ($5::date + time '11:30') at time zone 'America/Mexico_City')`,
          [v.org, v.prof, v.service, v.contact, f.day],
        ),
      );
      // Profesional y servicio los detecta el trigger; el contacto, la llave foránea compuesta.
      expect(expected === "23503" ? error.code : error.message).toBe(expected);
    }
    // Aun sin el trigger de validación, las llaves foráneas compuestas lo impiden.
    const client = await db.pool.connect();
    try {
      for (const v of variants.map((x) => x.v)) {
        await client.query("begin");
        await client.query("alter table public.appointments disable trigger appointments_before_write");
        const error = await expectPgError(
          client.query(
            `insert into public.appointments (organization_id, professional_id, service_id, contact_id, starts_at, ends_at)
             values ($1, $2, $3, $4, now() + interval '5 days', now() + interval '5 days 30 minutes')`,
            [v.org, v.prof, v.service, v.contact],
          ),
        );
        expect(error.code).toBe("23503");
        await client.query("rollback");
      }
    } finally {
      client.release();
    }
  });

  it("relación profesional–servicio entre espacios", async () => {
    const error = await expectPgError(
      db.sql(`insert into public.professional_services (organization_id, professional_id, service_id) values ($1, $2, $3)`, [
        f.clinicId,
        f.clinic.ruizId,
        f.indep.serviceId,
      ]),
    );
    expect(error.code).toBe("23503");
  });

  it("vincular una cuenta a un profesional de un espacio donde no es miembro", async () => {
    const error = await expectPgError(
      db.sql(`update public.professionals set user_id = $1 where id = $2`, [f.users.drHerrera.id, f.clinic.salasId]),
    );
    expect(error.code).toBe("23503");
  });

  it("mover un registro a otro espacio", async () => {
    const error = await expectPgError(
      db.sql(`update public.contacts set organization_id = $1 where id = $2`, [f.indepId, f.clinic.patientId]),
    );
    expect(error.message).toBe("organization_immutable");
  });
});

describe("cuentas sin sesión y escalamiento de privilegios", () => {
  it("anon no puede leer nada", async () => {
    for (const table of ["organizations", "contacts", "appointments", "professionals"]) {
      const error = await expectPgError(db.as(null, (s) => s.query(`select * from public.${table}`)));
      expect(error.code).toBe("42501");
    }
    const error = await expectPgError(db.as(null, (s) => s.query(`select public.create_organization('X', 'clinic')`)));
    expect(error.code).toBe("42501");
  });

  it("nadie puede crearse una membresía ni subirse el rol", async () => {
    const intruder = await db.createUser("intruso@correo.test");
    const insert = await expectPgError(
      db.as(intruder, (s) =>
        s.query(`insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [f.clinicId, intruder.id]),
      ),
    );
    expect(insert.code).toBe("42501");

    // Recepción intenta convertirse en administradora.
    const updated = await db.as(f.users.reception, (s) =>
      s.query(`update public.memberships set role = 'admin' where user_id = $1 returning id`, [f.users.reception.id]),
    );
    expect(updated).toHaveLength(0);
    const role = await db.one<{ role: string }>(
      `select role from public.memberships where user_id = $1 and organization_id = $2`,
      [f.users.reception.id, f.clinicId],
    );
    expect(role.role).toBe("reception");
  });

  it("crear un espacio es atómico y siempre otorga rol de administración al creador", async () => {
    const user = await db.createUser("nueva@clinica.test");
    const orgId = await db.as(user, async (s) => (await s.one<{ id: string }>(`select public.create_organization('Nueva clínica', 'clinic') as id`)).id);
    const membership = await db.one<{ role: string }>(`select role from public.memberships where organization_id = $1`, [orgId]);
    expect(membership.role).toBe("admin");

    // Con una zona horaria inválida no queda ningún rastro (ni espacio ni membresía).
    const before = await db.one<{ n: string }>(`select count(*) as n from public.organizations`);
    await expectPgError(db.as(user, (s) => s.query(`select public.create_organization('Otra', 'clinic', 'Marte/Olympus')`)));
    const after = await db.one<{ n: string }>(`select count(*) as n from public.organizations`);
    expect(after.n).toBe(before.n);
  });

  it("un espacio recién creado está vacío para su dueño", async () => {
    const user = await db.createUser("vacio@consultorio.test");
    await db.as(user, async (s) => {
      const orgId = (await s.one<{ id: string }>(`select public.create_organization('Vacío', 'independent') as id`)).id;
      for (const table of ["professionals", "services", "contacts", "appointments"]) {
        expect(await s.query(`select * from public.${table} where organization_id = $1`, [orgId])).toHaveLength(0);
      }
      expect(await s.query(`select * from public.contacts`)).toHaveLength(0);
    });
  });
});
