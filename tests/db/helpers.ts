import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, inject } from "vitest";

export type User = { id: string; email: string };
type Row = Record<string, unknown>;

export type Session = {
  query: <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>;
  one: <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T>;
};

/** Error de PostgreSQL con su código SQLSTATE y mensaje (p. ej. 'slot_taken'). */
export type PgError = Error & { code?: string; detail?: string };

function claimsFor(user: User) {
  return JSON.stringify({ sub: user.id, role: "authenticated", email: user.email, aud: "authenticated" });
}

function wrap(client: pg.PoolClient | pg.Client): Session {
  return {
    query: async (text, params) => (await client.query(text, params)).rows,
    one: async (text, params) => {
      const rows = (await client.query(text, params)).rows;
      if (rows.length !== 1) throw new Error(`Se esperaba 1 fila y llegaron ${rows.length}`);
      return rows[0];
    },
  };
}

export class TestDb {
  constructor(readonly pool: pg.Pool) {}

  /** Consulta como superusuario (equivale a migraciones/seed: sin auth.uid()). */
  async sql<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]> {
    return (await this.pool.query(text, params)).rows as T[];
  }

  async one<T extends Row = Row>(text: string, params?: unknown[]): Promise<T> {
    const rows = await this.sql<T>(text, params);
    if (rows.length !== 1) throw new Error(`Se esperaba 1 fila y llegaron ${rows.length}`);
    return rows[0];
  }

  async createUser(email: string, opts: { confirmed?: boolean; fullName?: string } = {}): Promise<User> {
    const id = randomUUID();
    await this.sql(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, $4, now(), now())`,
      [id, email, opts.confirmed === false ? null : new Date(), { full_name: opts.fullName ?? email.split("@")[0] }],
    );
    return { id, email };
  }

  /** Ejecuta fn en una transacción con el rol `authenticated` y los claims del usuario. */
  async as<T>(user: User | null, fn: (s: Session) => Promise<T>): Promise<T> {
    const session = await this.open(user);
    try {
      const result = await fn(session);
      await session.commit();
      return result;
    } catch (error) {
      await session.rollback();
      throw error;
    } finally {
      session.release();
    }
  }

  /** Abre una transacción controlada manualmente (para pruebas de concurrencia). */
  async open(user: User | null) {
    const client = await this.pool.connect();
    await client.query("begin");
    if (user) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [claimsFor(user)]);
    } else {
      await client.query("set local role anon");
    }
    const session = wrap(client);
    let released = false;
    return {
      ...session,
      commit: async () => {
        await client.query("commit");
      },
      rollback: async () => {
        await client.query("rollback").catch(() => {});
      },
      release: () => {
        if (!released) client.release();
        released = true;
      },
    };
  }

  async close() {
    await this.pool.end();
  }
}

/** Crea una base nueva a partir de la plantilla con las migraciones ya aplicadas. */
export async function freshDatabase(): Promise<TestDb> {
  const conn = inject("pg");
  const name = `t_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const admin = new pg.Client({ ...conn, database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${name} template ${conn.template}`);
  await admin.end();
  const pool = new pg.Pool({ ...conn, database: name, max: 30 });
  const db = new TestDb(pool);
  afterAll(() => db.close());
  return db;
}

/** Espera que la promesa falle y devuelve el error de PostgreSQL. */
export async function expectPgError(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    return error as PgError;
  }
  throw new Error("Se esperaba un error de PostgreSQL y la operación tuvo éxito");
}

/** Fecha local (YYYY-MM-DD) de dentro de `days` días en la zona indicada, ajustada a un día laborable. */
export async function futureWeekday(db: TestDb, tz: string, minDays = 2, isoDow = 3): Promise<string> {
  const row = await db.one<{ d: string }>(
    `select to_char(d, 'YYYY-MM-DD') as d
     from generate_series((now() at time zone $1)::date + $2::int, (now() at time zone $1)::date + $2::int + 6, interval '1 day') d
     where extract(isodow from d) = $3
     limit 1`,
    [tz, minDays, isoDow],
  );
  return row.d;
}

export type Fixture = Awaited<ReturnType<typeof buildFixture>>;

/**
 * Escenario base: una clínica (admin, recepción, dos profesionales — uno con cuenta)
 * y un consultorio independiente (admin que también atiende).
 * Se construye por la vía real: RPC create_organization + invitaciones.
 */
export async function buildFixture(db: TestDb) {
  const clinicAdmin = await db.createUser("admin@clinica.test", { fullName: "Laura Gómez" });
  const reception = await db.createUser("recepcion@clinica.test", { fullName: "Mario Pérez" });
  const drRuiz = await db.createUser("ana.ruiz@clinica.test", { fullName: "Ana Ruiz" });
  const drHerrera = await db.createUser("luis.herrera@consultorio.test", { fullName: "Luis Herrera" });

  const clinicId = await db.as(clinicAdmin, async (s) =>
    (await s.one<{ id: string }>(`select public.create_organization('Clínica Arboleda', 'clinic') as id`)).id,
  );
  const indepId = await db.as(drHerrera, async (s) =>
    (
      await s.one<{ id: string }>(
        `select public.create_organization('Consultorio Dr. Herrera', 'independent', 'America/Mexico_City', true, 'medico', 'Medicina interna') as id`,
      )
    ).id,
  );

  // Profesionales y servicios de la clínica (como administración).
  const clinic = await db.as(clinicAdmin, async (s) => {
    const ruiz = await s.one<{ id: string }>(
      `insert into public.professionals (organization_id, display_name, professional_type, specialty)
       values ($1, 'Dra. Ana Ruiz', 'medico', 'Medicina general') returning id`,
      [clinicId],
    );
    const salas = await s.one<{ id: string }>(
      `insert into public.professionals (organization_id, display_name, professional_type, specialty)
       values ($1, 'Dr. Jorge Salas', 'dentista', 'Odontología') returning id`,
      [clinicId],
    );
    const consulta = await s.one<{ id: string }>(
      `insert into public.services (organization_id, name, duration_minutes) values ($1, 'Consulta general', 30) returning id`,
      [clinicId],
    );
    const limpieza = await s.one<{ id: string }>(
      `insert into public.services (organization_id, name, duration_minutes) values ($1, 'Limpieza dental', 45) returning id`,
      [clinicId],
    );
    await s.query(
      `insert into public.professional_services (organization_id, professional_id, service_id)
       values ($1, $2, $3), ($1, $4, $5), ($1, $4, $3)`,
      [clinicId, ruiz.id, consulta.id, salas.id, limpieza.id],
    );
    const split = JSON.stringify(
      [1, 2, 3, 4, 5].flatMap((weekday) => [
        { weekday, start_time: "09:00", end_time: "13:00" },
        { weekday, start_time: "15:00", end_time: "18:00" },
      ]),
    );
    await s.query(`select public.set_weekly_schedule($1, $2::jsonb)`, [ruiz.id, split]);
    await s.query(`select public.set_weekly_schedule($1, $2::jsonb)`, [salas.id, split]);
    const patient = await s.one<{ id: string }>(
      `insert into public.contacts (organization_id, full_name, phone) values ($1, 'Paciente Clínica', '55 1234 5678') returning id`,
      [clinicId],
    );
    return { ruizId: ruiz.id, salasId: salas.id, consultaId: consulta.id, limpiezaId: limpieza.id, patientId: patient.id };
  });

  // Recepción y la Dra. Ruiz entran por invitación.
  const invite = async (email: string, role: string, professionalId: string | null) =>
    db.as(clinicAdmin, async (s) =>
      (
        await s.one<{ token: string }>(`select token from public.create_invitation($1, $2, $3::public.member_role, $4)`, [
          clinicId,
          email,
          role,
          professionalId,
        ])
      ).token,
    );
  const receptionToken = await invite(reception.email, "reception", null);
  await db.as(reception, (s) => s.query(`select public.accept_invitation($1)`, [receptionToken]));
  const ruizToken = await invite(drRuiz.email, "professional", clinic.ruizId);
  await db.as(drRuiz, (s) => s.query(`select public.accept_invitation($1)`, [ruizToken]));

  // Consultorio independiente: el admin ya es profesional (creado con "Yo también atiendo consultas").
  const indep = await db.as(drHerrera, async (s) => {
    const prof = await s.one<{ id: string }>(`select id from public.professionals where organization_id = $1`, [indepId]);
    const service = await s.one<{ id: string }>(
      `insert into public.services (organization_id, name, duration_minutes) values ($1, 'Consulta de primera vez', 45) returning id`,
      [indepId],
    );
    await s.query(`insert into public.professional_services (organization_id, professional_id, service_id) values ($1, $2, $3)`, [
      indepId,
      prof.id,
      service.id,
    ]);
    await s.query(`select public.set_weekly_schedule($1, $2::jsonb)`, [
      prof.id,
      JSON.stringify([1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: "08:00", end_time: "14:00" }))),
    ]);
    const patient = await s.one<{ id: string }>(
      `insert into public.contacts (organization_id, full_name, email) values ($1, 'Paciente Consultorio', 'paciente@correo.test') returning id`,
      [indepId],
    );
    return { professionalId: prof.id, serviceId: service.id, patientId: patient.id };
  });

  const day = await futureWeekday(db, "America/Mexico_City");

  return {
    users: { clinicAdmin, reception, drRuiz, drHerrera },
    clinicId,
    indepId,
    clinic,
    indep,
    day,
  };
}

/** Agenda vía RPC como lo hace la aplicación. Devuelve la fila creada. */
export async function book(
  s: Session,
  args: {
    professionalId: string;
    serviceId: string;
    contactId: string;
    date: string;
    time: string;
    status?: string;
    key?: string | null;
  },
) {
  return s.one<{ id: string; starts_at: Date; ends_at: Date; status: string }>(
    `select * from public.book_appointment($1, $2, $3, $4::date, $5::time, $6::public.appointment_status, null, $7)`,
    [args.professionalId, args.serviceId, args.contactId, args.date, args.time, args.status ?? "pending", args.key ?? null],
  );
}

/** Espera a que alguna sesión quede bloqueada esperando un lock (prueba de concurrencia real). */
export async function waitForLockWaiters(db: TestDb, count = 1, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await db.one<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (row.n >= count) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Ninguna sesión llegó a esperar un bloqueo en ${timeoutMs} ms`);
}
