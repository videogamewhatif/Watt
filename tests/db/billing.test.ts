// Suscripciones en PostgreSQL: aislamiento por tenant (RLS), sin escritura desde la
// aplicación, máquina de estados, idempotencia e integridad de importes.
// Los datos de facturación se insertan como superusuario: equivale al procesador
// de eventos de la pasarela, que usa credenciales de servicio.
import { beforeAll, describe, expect, it } from "vitest";
import { allowedStatusPairs, SUBSCRIPTION_STATUSES } from "../../src/features/billing/state-machine";
import { buildFixture, expectPgError, type Fixture, freshDatabase, type TestDb, type User } from "./helpers";

let db: TestDb;
let f: Fixture;
let clinic: { accountId: string; subId: string; invoiceId: string };
let indep: { accountId: string; subId: string; invoiceId: string };
let platformUser: User;

async function subscribe(orgId: string, planCode: string, email: string, ref: string) {
  const account = await db.one<{ id: string }>(
    `insert into public.billing_accounts (organization_id, legal_name, billing_email, contact_name, provider_customer_id)
     values ($1, 'Cuenta de prueba', $2, 'Contacto', $3) returning id`,
    [orgId, email, `cus_${ref}`],
  );
  const sub = await db.one<{ id: string }>(
    `insert into public.subscriptions (billing_account_id, workspace_id, plan_id, status, billing_interval, current_period_start, current_period_end)
     values ($1, $2, (select id from public.subscription_plans where code = $3), 'active', 'month', now(), now() + interval '1 month') returning id`,
    [account.id, orgId, planCode],
  );
  const invoice = await db.one<{ id: string }>(
    `insert into public.billing_invoices (billing_account_id, subscription_id, invoice_reference, subtotal_cents, tax_cents, amount_cents, status, paid_at, is_demo)
     values ($1, $2, $3, 77500, 12400, 89900, 'paid', now(), true) returning id`,
    [account.id, sub.id, `DEMO-${ref}`],
  );
  await db.sql(`insert into public.payment_attempts (subscription_id, invoice_id, amount_cents, status) values ($1, $2, 89900, 'succeeded')`, [sub.id, invoice.id]);
  await db.sql(
    `insert into public.billing_payment_methods (billing_account_id, provider_payment_method_id, brand, last4, exp_month, exp_year, is_default)
     values ($1, $2, 'Visa', '4242', 12, 2030, true)`,
    [account.id, `pm_${ref}`],
  );
  await db.sql(`insert into public.subscription_events (subscription_id, event_type, source, provider_event_id, to_status) values ($1, 'checkout_completed', 'provider', $2, 'active')`, [
    sub.id,
    `evt_${ref}`,
  ]);
  return { accountId: account.id, subId: sub.id, invoiceId: invoice.id };
}

beforeAll(async () => {
  db = await freshDatabase();
  f = await buildFixture(db);
  clinic = await subscribe(f.clinicId, "profesional", "facturacion@clinica.test", "clinic");
  indep = await subscribe(f.indepId, "esencial", "luis@consultorio.test", "indep");
  platformUser = await db.createUser("plataforma@wattalis.test");
  await db.sql(`insert into public.platform_admins (user_id) values ($1)`, [platformUser.id]);
});

describe("catálogo público", () => {
  it("cualquiera (sin sesión) consulta planes activos y sus funciones, pero nada más", async () => {
    await db.as(null, async (s) => {
      const plans = await s.query<{ code: string; monthly_price_cents: number | null }>(`select code, monthly_price_cents from public.subscription_plans order by display_order`);
      expect(plans.map((p) => p.code)).toEqual(["esencial", "profesional", "empresarial", "corporativo"]);
      expect(plans[1].monthly_price_cents).toBe(89900);
      expect((await s.query(`select * from public.plan_entitlements`)).length).toBeGreaterThan(20);
      const denied = await expectPgError(s.query(`select * from public.billing_accounts`));
      expect(denied.code).toBe("42501");
    });
  });

  it("un plan desactivado deja de verse públicamente (la plataforma sí lo ve)", async () => {
    await db.sql(`update public.subscription_plans set is_active = false where code = 'empresarial'`);
    try {
      await db.as(null, async (s) => expect((await s.query(`select 1 from public.subscription_plans`)).length).toBe(3));
      await db.as(platformUser, async (s) => expect((await s.query(`select 1 from public.subscription_plans`)).length).toBe(4));
    } finally {
      await db.sql(`update public.subscription_plans set is_active = true where code = 'empresarial'`);
    }
  });
});

describe("aislamiento entre clínicas", () => {
  it("la Clínica A ve su facturación y no la de la Clínica B, ni por id", async () => {
    await db.as(f.users.clinicAdmin, async (s) => {
      expect((await s.query(`select id from public.billing_accounts`)).map((r) => r.id)).toEqual([clinic.accountId]);
      expect((await s.query(`select id from public.subscriptions`)).map((r) => r.id)).toEqual([clinic.subId]);
      expect((await s.query(`select id from public.billing_invoices`)).map((r) => r.id)).toEqual([clinic.invoiceId]);
      for (const [table, id] of [
        ["billing_accounts", indep.accountId],
        ["subscriptions", indep.subId],
        ["billing_invoices", indep.invoiceId],
      ] as const) {
        expect(await s.query(`select * from public.${table} where id = $1`, [id]), table).toHaveLength(0);
      }
      expect(await s.query(`select * from public.billing_payment_methods where billing_account_id = $1`, [indep.accountId])).toHaveLength(0);
      expect(await s.query(`select * from public.payment_attempts where invoice_id = $1`, [indep.invoiceId])).toHaveLength(0);
      expect(await s.query(`select * from public.subscription_events where subscription_id = $1`, [indep.subId])).toHaveLength(0);
      expect(await s.query(`select * from public.workspace_entitlements($1)`, [f.indepId])).toHaveLength(0);
    });
  });

  it("la Clínica A no puede modificar la facturación de la Clínica B (ni la propia)", async () => {
    for (const sql of [
      `update public.subscriptions set status = 'canceled' where id = '${indep.subId}'`,
      `update public.billing_invoices set status = 'void' where id = '${indep.invoiceId}'`,
      `delete from public.billing_payment_methods where billing_account_id = '${indep.accountId}'`,
    ]) {
      // Cada intento en su propia transacción (un error aborta la transacción).
      const e = await expectPgError(db.as(f.users.clinicAdmin, (s) => s.query(sql)));
      expect(e.code, sql).toBe("42501");
    }
    const sub = await db.one<{ status: string }>(`select status from public.subscriptions where id = $1`, [indep.subId]);
    expect(sub.status).toBe("active");
  });
});

describe("roles dentro de la clínica", () => {
  it("Recepción y Profesional conocen el estado del plan, pero no ven cobros ni cuenta", async () => {
    for (const user of [f.users.reception, f.users.drRuiz]) {
      await db.as(user, async (s) => {
        expect((await s.query<{ status: string }>(`select status from public.subscriptions`)).map((r) => r.status)).toEqual(["active"]);
        expect(await s.query(`select * from public.billing_accounts`)).toHaveLength(0);
        expect(await s.query(`select * from public.billing_invoices`)).toHaveLength(0);
        expect(await s.query(`select * from public.billing_payment_methods`)).toHaveLength(0);
        const ents = await s.query<{ feature_code: string; usage_limit: number | null }>(`select feature_code, usage_limit from public.workspace_entitlements($1)`, [f.clinicId]);
        expect(ents.find((e) => e.feature_code === "professionals.max")?.usage_limit).toBe(5);
      });
    }
  });

  it("nadie de la clínica puede marcar un cobro como pagado ni cambiar el estado", async () => {
    const updates = [
      `update public.subscriptions set status = 'active', current_period_end = now() + interval '10 years' where id = '${clinic.subId}'`,
      `update public.billing_invoices set status = 'paid' where id = '${clinic.invoiceId}'`,
      `insert into public.payment_attempts (invoice_id, amount_cents, status) values ('${clinic.invoiceId}', 100, 'succeeded')`,
      `insert into public.subscription_events (subscription_id, event_type, source) values ('${clinic.subId}', 'renewed', 'user')`,
    ];
    for (const sql of updates) expect((await expectPgError(db.as(f.users.clinicAdmin, (s) => s.query(sql)))).code, sql).toBe("42501");
  });
});

describe("administrador global", () => {
  it("solo platform_admins ve todas las cuentas y la auditoría", async () => {
    await db.sql(`insert into public.billing_audit_log (actor_id, action, target_type) values ($1, 'plan.updated', 'subscription_plan')`, [platformUser.id]);
    await db.as(platformUser, async (s) => {
      expect((await s.query(`select id from public.billing_accounts`)).length).toBe(2);
      expect((await s.query(`select id from public.billing_audit_log`)).length).toBe(1);
      expect((await s.query(`select * from public.platform_admins`)).length).toBe(1);
    });
    await db.as(f.users.clinicAdmin, async (s) => {
      expect(await s.query(`select id from public.billing_audit_log`)).toHaveLength(0);
      expect(await s.query(`select * from public.platform_admins`)).toHaveLength(0);
      // Ser Administración de una clínica no otorga el rol de plataforma.
      expect((await expectPgError(s.query(`insert into public.platform_admins (user_id) values ($1)`, [f.users.clinicAdmin.id]))).code).toBe("42501");
    });
  });
});

describe("máquina de estados en la base", () => {
  it("coincide exactamente con la de la aplicación", async () => {
    const pairs = allowedStatusPairs();
    for (const from of SUBSCRIPTION_STATUSES) {
      for (const to of SUBSCRIPTION_STATUSES) {
        const row = await db.one<{ ok: boolean }>(`select private.subscription_transition_allowed($1, $2) as ok`, [from, to]);
        expect(row.ok, `${from} → ${to}`).toBe(pairs.has(`${from}>${to}`));
      }
    }
  });

  it("rechaza transiciones inválidas y registra cada cambio de estado", async () => {
    const e = await expectPgError(db.sql(`update public.subscriptions set status = 'incomplete' where id = $1`, [indep.subId]));
    expect(e.message).toBe("invalid_subscription_transition");
    await db.sql(`update public.subscriptions set status = 'past_due' where id = $1`, [indep.subId]);
    await db.sql(`update public.subscriptions set status = 'active' where id = $1`, [indep.subId]);
    const history = await db.sql<{ from_status: string; to_status: string }>(
      `select from_status, to_status from public.subscription_events where subscription_id = $1 and event_type = 'status_changed' order by created_at, id`,
      [indep.subId],
    );
    expect(history.map((h) => `${h.from_status}>${h.to_status}`)).toEqual(expect.arrayContaining(["active>past_due", "past_due>active"]));
    expect((await expectPgError(db.sql(`update public.subscriptions set status = 'canceled' where id = $1 returning id`, [clinic.subId]).then(() => db.sql(`update public.subscriptions set status = 'past_due' where id = $1`, [clinic.subId])))).message).toBe(
      "invalid_subscription_transition",
    );
    // Restaurar para las demás pruebas (canceled → active es una reactivación válida).
    await db.sql(`update public.subscriptions set status = 'active' where id = $1`, [clinic.subId]);
  });

  it("una suscripción nueva no puede nacer cancelada ni cambiar de dueño", async () => {
    const bad = await expectPgError(
      db.sql(`insert into public.subscriptions (billing_account_id, workspace_id, plan_id, status, billing_interval) values ($1, null, (select id from public.subscription_plans where code = 'esencial'), 'canceled', 'month')`, [indep.accountId]),
    );
    expect(bad.message).toBe("invalid_initial_subscription_status");
    const moved = await expectPgError(db.sql(`update public.subscriptions set billing_account_id = $1 where id = $2`, [clinic.accountId, indep.subId]));
    expect(moved.message).toBe("subscription_owner_immutable");
  });
});

describe("duplicados e integridad", () => {
  it("un espacio no tiene dos suscripciones vigentes", async () => {
    const e = await expectPgError(
      db.sql(`insert into public.subscriptions (billing_account_id, workspace_id, plan_id, status, billing_interval) values ($1, $2, (select id from public.subscription_plans where code = 'esencial'), 'incomplete', 'month')`, [
        indep.accountId,
        f.indepId,
      ]),
    );
    expect(e.code).toBe("23505");
  });

  it("un evento de la pasarela no se registra dos veces", async () => {
    const e = await expectPgError(db.sql(`insert into public.subscription_events (subscription_id, event_type, source, provider_event_id) values ($1, 'renewed', 'provider', 'evt_indep')`, [indep.subId]));
    expect(e.code).toBe("23505");
  });

  it("la suscripción solo cubre espacios de su cuenta", async () => {
    const e = await expectPgError(
      db.sql(`insert into public.subscriptions (billing_account_id, workspace_id, plan_id, status, billing_interval) values ($1, $2, (select id from public.subscription_plans where code = 'esencial'), 'incomplete', 'month')`, [
        indep.accountId,
        f.clinicId,
      ]),
    );
    expect(e.message).toBe("subscription_workspace_mismatch");
  });

  it("importes en centavos que cuadran, sin tarjetas completas y sin mezclar cuentas", async () => {
    const checks = [
      `insert into public.billing_invoices (billing_account_id, invoice_reference, subtotal_cents, tax_cents, amount_cents) values ('${indep.accountId}', 'DEMO-X1', 100, 16, 117)`,
      `insert into public.billing_invoices (billing_account_id, invoice_reference, subtotal_cents, tax_cents, amount_cents) values ('${indep.accountId}', 'DEMO-X2', -100, 0, -100)`,
      `insert into public.billing_invoices (billing_account_id, invoice_reference, subtotal_cents, tax_cents, amount_cents, status) values ('${indep.accountId}', 'DEMO-X3', 100, 16, 116, 'paid')`,
      `insert into public.billing_payment_methods (billing_account_id, provider_payment_method_id, brand, last4, exp_month, exp_year) values ('${indep.accountId}', 'pm_x', 'Visa', '4242424242424242', 12, 2030)`,
      `update public.subscription_plans set monthly_price_cents = -1 where code = 'esencial'`,
    ];
    for (const sql of checks) {
      const e = await expectPgError(db.sql(sql));
      expect(["23514", "22001"], sql).toContain(e.code);
    }
    const cross = await expectPgError(
      db.sql(`insert into public.billing_invoices (billing_account_id, subscription_id, invoice_reference, subtotal_cents, tax_cents, amount_cents) values ($1, $2, 'DEMO-X4', 100, 16, 116)`, [clinic.accountId, indep.subId]),
    );
    expect(cross.code).toBe("23503");
  });
});

describe("límites del plan verificados en la base (preparado)", () => {
  it("con enforce_limits, el plan Esencial no admite un segundo profesional activo", async () => {
    await db.sql(`update public.billing_settings set enforce_limits = true`);
    try {
      const e = await expectPgError(
        db.as(f.users.drHerrera, (s) => s.query(`insert into public.professionals (organization_id, display_name) values ($1, 'Segundo profesional')`, [f.indepId])),
      );
      expect(e.message).toBe("plan_limit_reached");
      // La clínica (Profesional, hasta 5) sí puede.
      await db.as(f.users.clinicAdmin, (s) => s.query(`insert into public.professionals (organization_id, display_name) values ($1, 'Tercer profesional')`, [f.clinicId]));
      // En impago el espacio queda en consulta: no se agregan profesionales, pero nada se borra.
      await db.sql(`update public.subscriptions set status = 'past_due' where id = $1`, [clinic.subId]);
      await db.sql(`update public.subscriptions set status = 'grace_period' where id = $1`, [clinic.subId]);
      await db.sql(`update public.subscriptions set status = 'unpaid' where id = $1`, [clinic.subId]);
      const ro = await expectPgError(db.as(f.users.clinicAdmin, (s) => s.query(`insert into public.professionals (organization_id, display_name) values ($1, 'Cuarto')`, [f.clinicId])));
      expect(ro.message).toBe("subscription_read_only");
      const count = await db.one<{ n: number }>(`select count(*)::int as n from public.professionals where organization_id = $1`, [f.clinicId]);
      expect(count.n).toBe(3);
    } finally {
      await db.sql(`update public.billing_settings set enforce_limits = false`);
    }
  });

  it("sin enforce_limits (valor inicial) los espacios existentes no cambian", async () => {
    await db.as(f.users.drHerrera, (s) => s.query(`insert into public.professionals (organization_id, display_name) values ($1, 'Segundo profesional')`, [f.indepId]));
  });
});
