// El seed de desarrollo es reproducible y respeta todas las reglas de la agenda.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, type TestDb } from "./helpers";

let db: TestDb;
const seedPath = path.resolve(import.meta.dirname, "../../supabase/seed.sql");

beforeAll(async () => {
  db = await freshDatabase();
  await db.sql(`create extension if not exists pgcrypto with schema extensions`);
});

describe("seed de desarrollo", () => {
  it("se aplica dos veces sin errores y deja los mismos datos", async () => {
    const seed = await readFile(seedPath, "utf8");
    await db.sql(seed);
    const counts = async () =>
      db.one<Record<string, number>>(`select
        (select count(*)::int from public.organizations) as orgs,
        (select count(*)::int from public.memberships) as memberships,
        (select count(*)::int from public.professionals) as professionals,
        (select count(*)::int from public.services) as services,
        (select count(*)::int from public.contacts) as contacts,
        (select count(*)::int from public.appointments) as appointments,
        (select count(*)::int from public.time_off) as blocks,
        (select count(*)::int from auth.users) as users`);
    const first = await counts();
    await db.sql(seed);
    expect(await counts()).toEqual(first);
    expect(first).toMatchObject({ orgs: 3, memberships: 5, professionals: 4, users: 4, blocks: 3 });
  });

  it("incluye citas cercanas a hoy, horarios partidos, un bloqueo y una cuenta con dos espacios", async () => {
    const near = await db.one<{ n: number }>(
      `select count(*)::int as n from public.appointments where starts_at between now() - interval '8 days' and now() + interval '15 days'`,
    );
    expect(near.n).toBeGreaterThan(20);
    const split = await db.one<{ n: number }>(
      `select count(*)::int as n from (select professional_id, weekday from public.availability_rules group by 1, 2 having count(*) > 1) x`,
    );
    expect(split.n).toBeGreaterThan(0);
    const multi = await db.one<{ n: number }>(`select count(distinct organization_id)::int as n from public.memberships m
      join auth.users u on u.id = m.user_id where u.email = 'recepcion@clinica-arboleda.test'`);
    expect(multi.n).toBe(2);
    const history = await db.sql<{ event_type: string }>(`select distinct event_type from public.appointment_events order by 1`);
    expect(history.map((h) => h.event_type).sort()).toEqual(["created", "rescheduled", "status_changed"]);
  });

  it("el consultorio independiente solo es visible para su doctor", async () => {
    const luis = await db.one<{ id: string; email: string }>(`select id, email from auth.users where email = 'luis.herrera@consultorio.test'`);
    const orgs = await db.as(luis, (s) => s.query<{ name: string }>(`select name from public.organizations`));
    expect(orgs.map((o) => o.name)).toEqual(["Consultorio Dr. Herrera (demo)"]);
    const contacts = await db.as(luis, (s) => s.query(`select * from public.contacts`));
    expect(contacts).toHaveLength(3);
  });
});
