// Resumen de Inicio, búsqueda de contactos y aviso al cambiar horarios.
import { beforeAll, describe, expect, it } from "vitest";
import { book, buildFixture, type Fixture, freshDatabase, futureWeekday, type TestDb } from "./helpers";

let db: TestDb;
let f: Fixture;
const TZ = "America/Mexico_City";

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
});

describe("resumen de Inicio", () => {
  it("cuenta registros reales de hoy y respeta el alcance del rol Profesional", async () => {
    // Citas de hoy cargadas como lo hace el seed (pueden estar en el pasado).
    const today = await db.one<{ d: string; dow: number }>(
      `select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as d, extract(isodow from (now() at time zone $1)::date)::int as dow`,
      [TZ],
    );
    // Horario de todo el día para que las citas de hoy siempre sean válidas.
    await db.sql(`delete from public.availability_rules where professional_id = any($1)`, [[f.clinic.ruizId, f.clinic.salasId]]);
    await db.sql(
      `insert into public.availability_rules (organization_id, professional_id, weekday, start_time, end_time)
       select $1, p, $2, '00:00', '24:00' from unnest($3::uuid[]) p`,
      [f.clinicId, today.dow, [f.clinic.ruizId, f.clinic.salasId]],
    );
    const insert = (prof: string, service: string, time: string, status: string) =>
      db.sql(
        `insert into public.appointments (organization_id, professional_id, service_id, contact_id, starts_at, ends_at, status)
         values ($1, $2, $3, $4, ($5::date + $6::time) at time zone $7, ($5::date + $6::time + interval '30 minutes') at time zone $7, $8)`,
        [f.clinicId, prof, service, f.clinic.patientId, today.d, time, TZ, status],
      );
    await insert(f.clinic.ruizId, f.clinic.consultaId, "00:30", "attended");
    await insert(f.clinic.ruizId, f.clinic.consultaId, "01:30", "no_show");
    await insert(f.clinic.salasId, f.clinic.consultaId, "02:30", "confirmed");
    await insert(f.clinic.salasId, f.clinic.consultaId, "03:30", "cancelled");

    const admin = await db.as(f.users.clinicAdmin, (s) => s.one<{ s: Record<string, unknown> }>(`select public.dashboard_summary($1) as s`, [f.clinicId]));
    expect(admin.s).toMatchObject({ today: today.d, today_total: 3, today_attended: 1, today_no_show: 1, today_confirmed: 1, today_cancelled: 1 });
    expect(admin.s.setup).toMatchObject({ has_professional: true, has_service: true, has_assignment: true, has_schedule: true, has_appointment: true });

    const ruiz = await db.as(f.users.drRuiz, (s) => s.one<{ s: Record<string, unknown> }>(`select public.dashboard_summary($1) as s`, [f.clinicId]));
    expect(ruiz.s).toMatchObject({ today_total: 2, today_attended: 1, today_no_show: 1, today_confirmed: 0, today_cancelled: 0 });
  });

  it("un espacio nuevo muestra todos los pasos para empezar", async () => {
    const user = await db.createUser("nuevo@consultorio.test");
    const summary = await db.as(user, async (s) => {
      const org = (await s.one<{ id: string }>(`select public.create_organization('Nuevo', 'independent') as id`)).id;
      return (await s.one<{ s: Record<string, unknown> }>(`select public.dashboard_summary($1) as s`, [org])).s;
    });
    expect(summary).toMatchObject({ today_total: 0, next_appointment: null });
    expect(summary.setup).toEqual({ has_professional: false, has_service: false, has_assignment: false, has_schedule: false, has_appointment: false });
  });
});

describe("búsqueda de contactos", () => {
  it("encuentra sin acentos, por teléfono con formato y por correo", async () => {
    await db.as(f.users.reception, async (s) => {
      await s.query(`insert into public.contacts (organization_id, full_name, phone, email) values ($1, 'José Núñez Ávila', '+52 (55) 4321-9876', 'jose.nunez@correo.test')`, [
        f.clinicId,
      ]);
      const byName = await s.query<{ full_name: string }>(`select full_name from public.search_contacts($1, 'jose nunez')`, [f.clinicId]);
      expect(byName.map((c) => c.full_name)).toEqual(["José Núñez Ávila"]);
      const byPhone = await s.query(`select id from public.search_contacts($1, '4321 9876')`, [f.clinicId]);
      expect(byPhone).toHaveLength(1);
      const byEmail = await s.query(`select id from public.search_contacts($1, 'NUNEZ@correo')`, [f.clinicId]);
      expect(byEmail).toHaveLength(1);
      const similar = await s.query(`select id from public.find_similar_contacts($1, 'Otra persona', '55 4321 9876')`, [f.clinicId]);
      expect(similar).toHaveLength(1); // mismo teléfono con o sin lada
    });
  });

  it("exige nombre y al menos un medio de contacto", async () => {
    const error = await db
      .as(f.users.reception, (s) => s.query(`insert into public.contacts (organization_id, full_name) values ($1, 'Sin contacto')`, [f.clinicId]))
      .catch((e) => e);
    expect(error.code).toBe("23514");
  });
});

describe("cambio de horario semanal", () => {
  it("avisa cuántas citas futuras quedaron fuera del nuevo horario sin cancelarlas", async () => {
    const owner = await db.createUser("horario@consultorio.test");
    await db.as(owner, async (s) => {
      const org = (await s.one<{ id: string }>(`select public.create_organization('Horario', 'independent', $1, true) as id`, [TZ])).id;
      const prof = (await s.one<{ id: string }>(`select id from public.professionals where organization_id = $1`, [org])).id;
      const svc = (await s.one<{ id: string }>(`insert into public.services (organization_id, name, duration_minutes) values ($1, 'Consulta', 30) returning id`, [org])).id;
      await s.query(`insert into public.professional_services (organization_id, professional_id, service_id) values ($1, $2, $3)`, [org, prof, svc]);
      await s.query(`select public.set_weekly_schedule($1, '[{"weekday":3,"start_time":"09:00","end_time":"18:00"}]'::jsonb)`, [prof]);
      const contact = (await s.one<{ id: string }>(`insert into public.contacts (organization_id, full_name, phone) values ($1, 'Paciente', '5512345678') returning id`, [org])).id;
      const d = await futureWeekday(db, TZ, 2, 3);
      const appt = await book(s, { professionalId: prof, serviceId: svc, contactId: contact, date: d, time: "16:00" });
      const outside = await s.one<{ n: number }>(
        `select public.set_weekly_schedule($1, '[{"weekday":3,"start_time":"09:00","end_time":"13:00"}]'::jsonb) as n`,
        [prof],
      );
      expect(outside.n).toBe(1);
      const still = await s.one<{ status: string }>(`select status from public.appointments where id = $1`, [appt.id]);
      expect(still.status).toBe("pending");
    });
  });
});
