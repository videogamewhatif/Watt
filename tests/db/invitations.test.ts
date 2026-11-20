// Escenario 11: invitaciones de un solo uso, con vencimiento y correo destinatario.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFixture, expectPgError, type Fixture, freshDatabase, type TestDb, type User } from "./helpers";

let db: TestDb;
let f: Fixture;

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
});

async function invite(email: string, role = "reception", professionalId: string | null = null) {
  return db.as(f.users.clinicAdmin, async (s) =>
    s.one<{ invitation_id: string; token: string; expires_at: Date }>(
      `select * from public.create_invitation($1, $2, $3::public.member_role, $4)`,
      [f.clinicId, email, role, professionalId],
    ),
  );
}

async function accept(user: User, token: string) {
  return db.as(user, (s) => s.one<{ org: string }>(`select public.accept_invitation($1) as org`, [token]));
}

async function membership(user: User) {
  return db.sql<{ role: string }>(`select role from public.memberships where user_id = $1 and organization_id = $2`, [user.id, f.clinicId]);
}

describe("invitaciones", () => {
  it("solo guarda el hash del token y el enlace se usa una sola vez", async () => {
    const user = await db.createUser("nuevo.recep@clinica.test");
    const inv = await invite(user.email);
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    const stored = await db.one<{ token_hash: string }>(`select token_hash from public.invitations where id = $1`, [inv.invitation_id]);
    expect(stored.token_hash).toBe(createHash("sha256").update(inv.token).digest("hex"));
    expect(JSON.stringify(await db.sql(`select * from public.invitations`))).not.toContain(inv.token);

    const accepted = await accept(user, inv.token);
    expect(accepted.org).toBe(f.clinicId);
    expect(await membership(user)).toEqual([{ role: "reception" }]);

    const reused = await expectPgError(accept(user, inv.token));
    expect(reused.message).toBe("invitation_used");
    const other = await db.createUser("otro@clinica.test");
    expect((await expectPgError(accept(other, inv.token))).message).toBe("invitation_used");
  });

  it("una invitación vencida no concede acceso", async () => {
    const user = await db.createUser("tarde@clinica.test");
    const inv = await invite(user.email);
    await db.sql(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [inv.invitation_id]);
    const status = await db.as(user, (s) => s.one<{ status: string }>(`select status from public.get_invitation($1)`, [inv.token]));
    expect(status.status).toBe("expired");
    expect((await expectPgError(accept(user, inv.token))).message).toBe("invitation_expired");
    expect(await membership(user)).toEqual([]);
  });

  it("abierta con un correo distinto no concede acceso y sigue disponible para el destinatario", async () => {
    const invited = await db.createUser("destinataria@clinica.test");
    const intruder = await db.createUser("intrusa@correo.test");
    const inv = await invite(invited.email);
    const info = await db.as(intruder, (s) => s.one<{ email_matches: boolean; status: string; email_hint: string }>(`select * from public.get_invitation($1)`, [inv.token]));
    expect(info).toMatchObject({ email_matches: false, status: "valid", email_hint: "de•••@clinica.test" });
    expect((await expectPgError(accept(intruder, inv.token))).message).toBe("invitation_email_mismatch");
    expect(await membership(intruder)).toEqual([]);
    await accept(invited, inv.token);
    expect(await membership(invited)).toEqual([{ role: "reception" }]);
  });

  it("exige que el correo de la cuenta esté verificado", async () => {
    const unverified = await db.createUser("sin.verificar@clinica.test", { confirmed: false });
    const inv = await invite(unverified.email);
    expect((await expectPgError(accept(unverified, inv.token))).message).toBe("email_not_verified");
  });

  it("una invitación revocada o reemplazada no sirve", async () => {
    const user = await db.createUser("revocada@clinica.test");
    const first = await invite(user.email);
    const second = await invite(user.email); // reemplaza a la primera
    expect((await expectPgError(accept(user, first.token))).message).toBe("invitation_revoked");
    await db.as(f.users.clinicAdmin, (s) => s.query(`update public.invitations set revoked_at = now() where id = $1`, [second.invitation_id]));
    expect((await expectPgError(accept(user, second.token))).message).toBe("invitation_revoked");
  });

  it("un token inventado no revela nada", async () => {
    const user = await db.createUser("curioso@correo.test");
    const info = await db.as(user, (s) => s.one(`select * from public.get_invitation('no-existe')`));
    expect(info).toMatchObject({ status: "invalid", organization_name: null });
    expect((await expectPgError(accept(user, "0".repeat(64)))).message).toBe("invitation_invalid");
    const anon = await expectPgError(db.as(null, (s) => s.query(`select public.accept_invitation('x')`)));
    expect(anon.code).toBe("42501");
  });

  it("el rol lo fija la invitación (no el navegador) y puede vincular un perfil profesional", async () => {
    const dentist = await db.createUser("Jorge.Salas@Clinica.test");
    const inv = await invite("JORGE.SALAS@clinica.test", "professional", f.clinic.salasId);
    await accept(dentist, inv.token);
    expect(await membership(dentist)).toEqual([{ role: "professional" }]);
    const prof = await db.one<{ user_id: string }>(`select user_id from public.professionals where id = $1`, [f.clinic.salasId]);
    expect(prof.user_id).toBe(dentist.id);
    // Ahora ve su propia agenda y no la de la Dra. Ruiz.
    const visible = await db.as(dentist, (s) => s.query<{ id: string }>(`select id from public.professionals`));
    expect(visible.map((p) => p.id)).toEqual([f.clinic.salasId]);
  });

  it("no invita a quien ya es miembro ni vincula perfiles ya vinculados", async () => {
    expect((await expectPgError(invite(f.users.reception.email))).message).toBe("already_member");
    expect((await expectPgError(invite("x@clinica.test", "professional", f.clinic.ruizId))).message).toBe("invalid_professional_link");
    expect((await expectPgError(invite("x@clinica.test", "reception", f.clinic.salasId))).message).toBe("invalid_professional_link");
  });
});
