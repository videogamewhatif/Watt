// Suscripciones · servicio completo con la pasarela simulada y datos ficticios.
import { describe, expect, it } from "vitest";
import { BillingAccessError } from "@/features/billing/authz";
import { WebhookSignatureError } from "@/features/billing/providers/types";
import { BillingError } from "@/features/billing/service";
import { allowedStatusPairs, InvalidTransitionError } from "@/features/billing/state-machine";
import { ACTORS, DETAILS, key, makeBilling, NEW_ORG, ORG } from "./billing-helpers";

const usage = { professionals: 1, users: 1 };

async function subscribeNewOrg(b: ReturnType<typeof makeBilling>, outcome: "approved" | "declined" | "pending" = "approved", plan = "profesional", interval: "month" | "year" = "month") {
  await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
  const { sessionId, url } = await b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: plan, interval, acceptedTerms: true, idempotencyKey: key() });
  await b.service.simulateCheckout(ACTORS.sofia, sessionId, outcome);
  return { sessionId, url };
}

describe("selección de planes", () => {
  it("el catálogo público lista solo planes activos, en orden", async () => {
    const b = makeBilling();
    const { plans } = await b.service.getCatalog();
    expect(plans.map((p) => p.code)).toEqual(["esencial", "profesional", "empresarial", "corporativo"]);
    const profesional = plans.find((p) => p.code === "profesional")!;
    await b.service.adminUpdatePlan(ACTORS.platform, profesional.id, { is_active: false });
    expect((await b.service.getCatalog()).plans.map((p) => p.code)).not.toContain("profesional");
    await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
    await expect(b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "profesional", interval: "month", acceptedTerms: true, idempotencyKey: key() })).rejects.toThrow(/no está disponible/);
  });

  it("Corporativo no se contrata en línea", async () => {
    const b = makeBilling();
    await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
    await expect(b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "corporativo", interval: "month", acceptedTerms: true, idempotencyKey: key() })).rejects.toThrow(/equipo comercial/);
  });
});

describe("contratación simulada (escenario 1: cliente nuevo)", () => {
  it("de la selección al pago aprobado: suscripción activa del espacio, comprobante y avisos", async () => {
    const b = makeBilling();
    const before = await b.service.getEntitlements(ACTORS.sofia, NEW_ORG);
    expect(before.status).toBe("none");
    const { url } = await subscribeNewOrg(b, "approved", "profesional", "year");
    expect(url).toMatch(/^\/suscripcion\/pago\?sesion=cs_demo_/);

    const overview = await b.service.getOverview(ACTORS.sofia, NEW_ORG);
    expect(overview.subscription).toMatchObject({ status: "active", workspace_id: NEW_ORG, billing_interval: "year", cancel_at_period_end: false });
    expect(overview.account?.organization_id).toBe(NEW_ORG);
    expect(overview.plan?.code).toBe("profesional");
    const days = (new Date(overview.subscription!.current_period_end!).getTime() - b.now.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(364);

    const invoices = await b.service.listInvoices(ACTORS.sofia, NEW_ORG);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: "paid", amount_cents: 916_980, is_demo: true });
    expect(invoices[0].invoice_reference).toMatch(/^DEMO-2026-/);
    // Las notificaciones se revisan antes de renovar.

    const templates = (await b.service.listNotifications(ACTORS.sofia, NEW_ORG)).map((n) => n.template);
    expect(templates).toEqual(expect.arrayContaining(["welcome", "subscription_activated", "payment_succeeded"]));
    expect((await b.service.listNotifications(ACTORS.sofia, NEW_ORG)).every((n) => n.status === "demo_not_sent")).toBe(true);

    // La tarjeta de prueba usada en el pago queda como predeterminada (como en Stripe Checkout)…
    expect((await b.service.listPaymentMethods(ACTORS.sofia, NEW_ORG)).map((m) => [m.last4, m.is_default])).toEqual([["4242", true]]);
    // …y la siguiente renovación se puede cobrar.
    await b.service.runRenewal(overview.subscription!.id);
    expect((await b.service.getOverview(ACTORS.sofia, NEW_ORG)).subscription?.status).toBe("active");

    const ent = await b.service.getEntitlements(ACTORS.sofia, NEW_ORG);
    expect(ent).toMatchObject({ status: "active", access: "full" });
    expect(ent.features["reports.financial"]).toBe(true);
    expect(ent.limits["professionals.max"]).toBe(5);
  });

  it("exige aceptar términos y no duplica la sesión con doble clic", async () => {
    const b = makeBilling();
    await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
    await expect(b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: false, idempotencyKey: key() })).rejects.toThrow(/términos/);
    const k = key();
    const [a, c] = await Promise.all([
      b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: k }),
      b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: k }),
    ]);
    expect(a.sessionId).toBe(c.sessionId);
    expect(b.repo.raw.subscriptions.filter((s) => s.workspace_id === NEW_ORG)).toHaveLength(1);
  });

  it("un espacio con suscripción activa no puede contratar otra (evita duplicados)", async () => {
    const b = makeBilling();
    await expect(b.service.startCheckout(ACTORS.laura, { workspaceId: ORG.clinic, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: key() })).rejects.toThrow(/ya tiene una suscripción/);
  });
});

describe("pago rechazado y pendiente", () => {
  it("rechazo en la contratación: queda incompleta, sin acceso de escritura, y se puede reintentar", async () => {
    const b = makeBilling();
    const { sessionId } = await subscribeNewOrg(b, "declined");
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === NEW_ORG)!;
    expect(sub.status).toBe("incomplete");
    expect(b.repo.raw.payment_attempts.filter((a) => a.subscription_id === sub.id).map((a) => a.status)).toEqual(["failed"]);
    expect((await b.service.getEntitlements(null, NEW_ORG)).access).toBe("read_only");
    await b.service.simulateCheckout(ACTORS.sofia, sessionId, "approved");
    expect(b.repo.raw.subscriptions.find((s) => s.id === sub.id)!.status).toBe("active");
  });

  it("pago pendiente: no activa hasta que la pasarela lo confirma", async () => {
    const b = makeBilling();
    const { sessionId } = await subscribeNewOrg(b, "pending");
    expect((await b.service.getCheckout(ACTORS.sofia, sessionId))!.session.status).toBe("pending");
    expect(b.repo.raw.subscriptions.find((s) => s.workspace_id === NEW_ORG)!.status).toBe("incomplete");
    await expect(b.service.simulateCheckout(ACTORS.sofia, sessionId, "canceled")).rejects.toThrow(/pendiente/);
    await b.service.simulateCheckout(ACTORS.sofia, sessionId, "approved");
    expect(b.repo.raw.subscriptions.find((s) => s.workspace_id === NEW_ORG)!.status).toBe("active");
  });

  it("cancelar el proceso de pago anula el comprobante y permite volver a empezar", async () => {
    const b = makeBilling();
    await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
    const { sessionId } = await b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: key() });
    await b.service.simulateCheckout(ACTORS.sofia, sessionId, "canceled");
    const session = (await b.service.getCheckout(ACTORS.sofia, sessionId))!;
    expect(session.session.status).toBe("canceled");
    expect(session.invoice.status).toBe("void");
    await expect(b.service.simulateCheckout(ACTORS.sofia, sessionId, "approved")).rejects.toThrow(/ya no admite/);
  });
});

describe("renovación", () => {
  it("renovación aprobada: nuevo periodo, comprobante pagado y estado activo", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    const end = sub.current_period_end!;
    await b.service.adminSimulate(ACTORS.platform, sub.id, "renew_approved");
    const after = b.repo.raw.subscriptions.find((s) => s.id === sub.id)!;
    expect(after.status).toBe("active");
    expect(after.current_period_start).toBe(end);
    const last = b.repo.raw.billing_invoices.filter((i) => i.subscription_id === sub.id).at(-1)!;
    expect(last).toMatchObject({ status: "paid", period_start: end, amount_cents: 199_900 });
    expect(b.repo.raw.billing_audit_log.at(-1)?.action).toBe("simulation.renew_approved");
  });

  it("al terminar la prueba se cobra con la tarjeta registrada", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.nutrition)!;
    expect(sub.status).toBe("trialing");
    await b.service.runRenewal(sub.id);
    expect(b.repo.raw.subscriptions.find((s) => s.id === sub.id)!.status).toBe("active");
  });
});

describe("pago rechazado → periodo de gracia → regularización (escenario 3)", () => {
  it("recorre past_due, grace_period (7 días), unpaid y vuelve a active sin perder información", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    await b.service.adminSimulate(ACTORS.platform, sub.id, "renew_declined");
    expect(b.repo.raw.subscriptions.find((s) => s.id === sub.id)!.status).toBe("past_due");
    expect((await b.service.getEntitlements(null, ORG.clinic)).access).toBe("full");

    await b.service.adminSimulate(ACTORS.platform, sub.id, "retry_declined");
    const grace = b.repo.raw.subscriptions.find((s) => s.id === sub.id)!;
    expect(grace.status).toBe("grace_period");
    expect((new Date(grace.grace_ends_at!).getTime() - b.now.getTime()) / 86_400_000).toBe(7);

    await b.service.adminSimulate(ACTORS.platform, sub.id, "expire_grace");
    expect(b.repo.raw.subscriptions.find((s) => s.id === sub.id)!.status).toBe("unpaid");
    expect((await b.service.getEntitlements(null, ORG.clinic)).access).toBe("read_only");

    // La clínica actualiza su tarjeta y reintenta: la pasarela aprueba.
    await b.service.addPaymentMethod(ACTORS.laura, ORG.clinic, "mc_4444");
    await b.service.retryPaymentAsUser(ACTORS.laura, ORG.clinic);
    const fixed = b.repo.raw.subscriptions.find((s) => s.id === sub.id)!;
    expect(fixed).toMatchObject({ status: "active", grace_ends_at: null });
    const transitions = (await b.service.listHistory(ACTORS.laura, ORG.clinic)).filter((e) => e.from_status !== e.to_status).map((e) => e.to_status);
    expect(transitions.slice(0, 4)).toEqual(["active", "unpaid", "grace_period", "past_due"]);
  });

  it("el periodo de gracia es configurable", async () => {
    const b = makeBilling();
    await b.service.adminUpdateSettings(ACTORS.platform, { grace_period_days: 3 });
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    await b.service.runRenewal(sub.id, { outcome: "declined" });
    await b.service.retryPayment(sub.id, { outcome: "declined" });
    const grace = b.repo.raw.subscriptions.find((s) => s.id === sub.id)!;
    expect((new Date(grace.grace_ends_at!).getTime() - b.now.getTime()) / 86_400_000).toBe(3);
  });
});

describe("cambio de plan", () => {
  it("mejora inmediata con prorrateo (escenario 2: Esencial → Profesional)", async () => {
    const b = makeBilling();
    const before = await b.service.getEntitlements(ACTORS.luis, ORG.independent);
    expect(before.features["reports.financial"]).toBe(false);
    const preview = await b.service.previewChange(ACTORS.luis, ORG.independent, "profesional", "month", usage);
    expect(preview).toMatchObject({ kind: "upgrade", immediate: true, blocked: null });
    expect(preview.gained).toContain("reports.financial");
    expect(preview.proration!.amountDueCents).toBeGreaterThan(0);
    expect(preview.proration!.amountDueCents).toBeLessThan(50_000);

    const result = await b.service.changePlan(ACTORS.luis, ORG.independent, "profesional", "month", usage);
    expect(result.applied).toBe(true);
    const after = await b.service.getEntitlements(ACTORS.luis, ORG.independent);
    expect(after.plan?.code).toBe("profesional");
    expect(after.features["reports.financial"]).toBe(true);
    expect(after.limits["professionals.max"]).toBe(5);
    const invoice = (await b.service.listInvoices(ACTORS.luis, ORG.independent))[0];
    expect(invoice).toMatchObject({ status: "paid", amount_cents: preview.proration!.amountDueCents });
    expect(invoice.description).toMatch(/diferencia proporcional/);
  });

  it("si la pasarela rechaza la diferencia, el plan no cambia", async () => {
    const b = makeBilling();
    await b.service.addPaymentMethod(ACTORS.luis, ORG.independent, "visa_0002");
    await expect(b.service.changePlan(ACTORS.luis, ORG.independent, "profesional", "month", usage)).rejects.toThrow(/rechazó/);
    expect((await b.service.getEntitlements(null, ORG.independent)).plan?.code).toBe("esencial");
  });

  it("reducción programada al final del periodo, con aviso de límites y sin borrar nada", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    const preview = await b.service.previewChange(ACTORS.laura, ORG.clinic, "esencial", "month", { professionals: 2, users: 3 });
    expect(preview).toMatchObject({ kind: "downgrade", immediate: false, effectiveAt: sub.current_period_end });
    expect(preview.lost).toEqual(expect.arrayContaining(["areas.multiple", "reports.financial", "reports.advanced"]));
    expect(preview.limitWarnings).toEqual([
      { code: "professionals.max", usage: 2, limit: 1 },
      { code: "users.max", usage: 3, limit: 2 },
    ]);
    const result = await b.service.changePlan(ACTORS.laura, ORG.clinic, "esencial", "month", { professionals: 2, users: 3 });
    expect(result).toMatchObject({ applied: false, effectiveAt: sub.current_period_end });
    // Hasta el fin del periodo conserva el plan actual.
    expect((await b.service.getEntitlements(null, ORG.clinic)).plan?.code).toBe("empresarial");
    expect((await b.service.getOverview(ACTORS.laura, ORG.clinic)).scheduledChange?.toPlan.code).toBe("esencial");
    // Al renovar se aplica el cambio y se cobra el nuevo precio.
    await b.service.runRenewal(sub.id);
    const ent = await b.service.getEntitlements(null, ORG.clinic);
    expect(ent.plan?.code).toBe("esencial");
    expect(ent.features["areas.multiple"]).toBe(false);
    expect(b.repo.raw.billing_invoices.filter((i) => i.subscription_id === sub.id).at(-1)!.amount_cents).toBe(39_900);
  });

  it("mensual → anual es una mejora; anual → mensual se programa", async () => {
    const b = makeBilling();
    expect((await b.service.previewChange(ACTORS.luis, ORG.independent, "esencial", "year", usage)).kind).toBe("upgrade");
    await b.service.changePlan(ACTORS.luis, ORG.independent, "esencial", "year", usage);
    const sub = (await b.service.getOverview(ACTORS.luis, ORG.independent)).subscription!;
    expect(sub.billing_interval).toBe("year");
    expect((await b.service.previewChange(ACTORS.luis, ORG.independent, "esencial", "month", usage)).kind).toBe("downgrade");
  });

  it("un cambio programado se puede deshacer", async () => {
    const b = makeBilling();
    await b.service.changePlan(ACTORS.laura, ORG.clinic, "profesional", "month", usage);
    await b.service.cancelScheduledChange(ACTORS.laura, ORG.clinic);
    expect((await b.service.getOverview(ACTORS.laura, ORG.clinic)).scheduledChange).toBeNull();
  });
});

describe("cancelación y reactivación (escenario 4)", () => {
  it("cancelar al final del periodo conserva el acceso; se puede deshacer", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    const { accessUntil } = await b.service.scheduleCancellation(ACTORS.laura, ORG.clinic, "Prueba de cancelación");
    expect(accessUntil).toBe(sub.current_period_end);
    const ov = await b.service.getOverview(ACTORS.laura, ORG.clinic);
    expect(ov.subscription).toMatchObject({ status: "active", cancel_at_period_end: true, cancellation_reason: "Prueba de cancelación" });
    expect(ov.entitlements.access).toBe("full");
    await expect(b.service.scheduleCancellation(ACTORS.laura, ORG.clinic, null)).rejects.toThrow(/ya está programada/);
    await b.service.undoCancellation(ACTORS.laura, ORG.clinic);
    expect((await b.service.getOverview(ACTORS.laura, ORG.clinic)).subscription?.cancel_at_period_end).toBe(false);
  });

  it("al vencer queda cancelada en modo de consulta y se reactiva con un nuevo pago", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    await b.service.scheduleCancellation(ACTORS.laura, ORG.clinic, null);
    await b.service.adminSimulate(ACTORS.platform, sub.id, "renew_approved");
    const canceled = b.repo.raw.subscriptions.find((s) => s.id === sub.id)!;
    expect(canceled.status).toBe("canceled");
    expect(canceled.ended_at).toBe(sub.current_period_end);
    expect((await b.service.getEntitlements(null, ORG.clinic)).access).toBe("read_only");
    expect(await b.service.checkoutEligibility(ACTORS.laura, ORG.clinic)).toEqual({ ok: true, mode: "reactivate" });

    const { sessionId } = await b.service.startCheckout(ACTORS.laura, { workspaceId: ORG.clinic, planCode: "empresarial", interval: "month", acceptedTerms: true, idempotencyKey: key() });
    await b.service.simulateCheckout(ACTORS.laura, sessionId, "approved");
    const back = b.repo.raw.subscriptions.find((s) => s.id === sub.id)!;
    expect(back).toMatchObject({ status: "active", cancel_at_period_end: false, ended_at: null });
    const types = (await b.service.listHistory(ACTORS.laura, ORG.clinic)).map((e) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(["cancel_scheduled", "period_ended_canceled", "reactivated"]));
  });
});

describe("permisos por rol y aislamiento entre clínicas", () => {
  it("Recepción y Profesional conocen el plan (para restricciones) pero no ven la facturación", async () => {
    const b = makeBilling();
    for (const a of [ACTORS.mario, ACTORS.ana]) {
      expect((await b.service.getEntitlements(a, ORG.clinic)).plan?.code).toBe("empresarial");
      await expect(b.service.getOverview(a, ORG.clinic)).rejects.toBeInstanceOf(BillingAccessError);
      await expect(b.service.listInvoices(a, ORG.clinic)).rejects.toBeInstanceOf(BillingAccessError);
      await expect(b.service.scheduleCancellation(a, ORG.clinic, null)).rejects.toBeInstanceOf(BillingAccessError);
    }
    // Mario sí administra su otro espacio.
    expect((await b.service.getOverview(ACTORS.mario, ORG.nutrition)).subscription?.status).toBe("trialing");
  });

  it("un usuario de la Clínica A no consulta ni modifica la facturación de la Clínica B", async () => {
    const b = makeBilling();
    const A = ACTORS.laura;
    const B = ORG.independent;
    await expect(b.service.getEntitlements(A, B)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.getOverview(A, B)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.listInvoices(A, B)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.listNotifications(A, B)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.listPaymentMethods(A, B)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.scheduleCancellation(A, B, null)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.changePlan(A, B, "empresarial", "month", usage)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.addPaymentMethod(A, B, "visa_4242")).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.retryPaymentAsUser(A, B)).rejects.toBeInstanceOf(BillingAccessError);

    // Pedir un comprobante de B "desde" A responde como inexistente.
    const invoiceOfB = b.repo.raw.billing_invoices.find((i) => i.billing_account_id === b.repo.raw.billing_accounts.find((a) => a.organization_id === B)!.id)!;
    expect(await b.service.getInvoice(A, ORG.clinic, invoiceOfB.id)).toBeNull();
    // Un método de pago de B no se puede borrar desde A ni pasando el id.
    const methodOfB = b.repo.raw.billing_payment_methods.find((m) => m.billing_account_id === invoiceOfB.billing_account_id)!;
    await expect(b.service.removePaymentMethod(A, ORG.clinic, methodOfB.id)).rejects.toBeInstanceOf(BillingAccessError);
    expect(b.repo.raw.billing_payment_methods.some((m) => m.id === methodOfB.id)).toBe(true);

    // La sesión de pago de otro espacio tampoco se ve ni se puede simular.
    await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
    const { sessionId } = await b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: key() });
    expect(await b.service.getCheckout(A, sessionId)).toBeNull();
    await expect(b.service.simulateCheckout(A, sessionId, "approved")).rejects.toBeInstanceOf(BillingAccessError);
    expect(b.repo.raw.subscriptions.find((s) => s.workspace_id === NEW_ORG)!.status).toBe("incomplete");
  });
});

describe("administrador global de Wattalis", () => {
  it("solo el rol de plataforma entra; Administración de una clínica no", async () => {
    const b = makeBilling();
    await expect(b.service.adminDashboard(ACTORS.laura)).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.adminUpdateSettings(ACTORS.laura, { grace_period_days: 1 })).rejects.toBeInstanceOf(BillingAccessError);
    const plan = b.repo.raw.plans[0];
    await expect(b.service.adminUpdatePlan(ACTORS.laura, plan.id, { monthly_price_cents: 1 })).rejects.toBeInstanceOf(BillingAccessError);
    await expect(b.service.adminSimulate(ACTORS.luis, b.repo.raw.subscriptions[0].id, "cancel_now")).rejects.toBeInstanceOf(BillingAccessError);

    const dash = await b.service.adminDashboard(ACTORS.platform);
    expect(dash.metrics.organizations).toBe(b.repo.raw.billing_accounts.length);
    expect(dash.metrics.mrrCents).toBeGreaterThan(0);
    expect(dash.metrics.arrCents).toBe(dash.metrics.mrrCents * 12);
    expect(dash.metrics.months).toHaveLength(12);
    expect(dash.providerLive).toBe(false);
  });

  it("modifica precios (con auditoría) y el anual se recalcula con el descuento", async () => {
    const b = makeBilling();
    const esencial = b.repo.raw.plans.find((p) => p.code === "esencial")!;
    await b.service.adminUpdatePlan(ACTORS.platform, esencial.id, { monthly_price_cents: 49_900 });
    expect(b.repo.raw.plans.find((p) => p.id === esencial.id)).toMatchObject({ monthly_price_cents: 49_900, annual_price_cents: 508_980 });
    await b.service.adminUpdateSettings(ACTORS.platform, { annual_discount_bps: 2000 });
    expect(b.repo.raw.plans.find((p) => p.id === esencial.id)!.annual_price_cents).toBe(479_040);
    expect(b.repo.raw.billing_audit_log.map((a) => a.action)).toEqual(["plan.updated", "settings.updated"]);
    await expect(b.service.adminUpdatePlan(ACTORS.platform, esencial.id, { monthly_price_cents: -5 })).rejects.toThrow(/precio válido/);
  });

  it("edita límites y funciones de un plan", async () => {
    const b = makeBilling();
    const esencial = b.repo.raw.plans.find((p) => p.code === "esencial")!;
    await b.service.adminUpdateEntitlements(ACTORS.platform, esencial.id, [
      { feature_code: "professionals.max", enabled: true, usage_limit: 2 },
      { feature_code: "reports.financial", enabled: true, usage_limit: null },
    ]);
    const ent = await b.service.getEntitlements(null, ORG.independent);
    expect(ent.limits["professionals.max"]).toBe(2);
    expect(ent.features["reports.financial"]).toBe(true);
    expect(ent.features["module.agenda"]).toBe(true);
    await expect(b.service.adminUpdateEntitlements(ACTORS.platform, esencial.id, [{ feature_code: "inventado", enabled: true, usage_limit: null }])).rejects.toThrow(/desconocida/);
  });

  it("reinicia los datos de demostración", async () => {
    const b = makeBilling();
    await b.service.scheduleCancellation(ACTORS.laura, ORG.clinic, null);
    await b.service.adminReset(ACTORS.platform);
    expect((await b.service.getOverview(ACTORS.laura, ORG.clinic)).subscription?.cancel_at_period_end).toBe(false);
  });
});

describe("eventos de la pasarela: firma, duplicados e idempotencia", () => {
  it("el mismo evento entregado dos veces (incluso a la vez) se aplica una sola vez", async () => {
    const b = makeBilling();
    await b.service.ensureAccount(ACTORS.sofia, NEW_ORG, DETAILS);
    const { sessionId } = await b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: key() });
    const session = (await b.service.getCheckout(ACTORS.sofia, sessionId))!.session;
    const { rawBody, signature } = b.provider.signEvent({ type: "checkout.completed", data: { checkoutSessionId: sessionId, subscriptionId: session.subscription_id, amountCents: session.amount_cents } });
    const results = await Promise.all([b.service.processWebhook(rawBody, signature), b.service.processWebhook(rawBody, signature)]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect((await b.service.processWebhook(rawBody, signature)).duplicate).toBe(true);
    expect(b.repo.raw.payment_attempts.filter((a) => a.subscription_id === session.subscription_id && a.status === "succeeded")).toHaveLength(1);
    expect(b.repo.raw.subscription_events.filter((e) => e.event_type === "checkout_completed" && e.subscription_id === session.subscription_id)).toHaveLength(1);
  });

  it("rechaza eventos sin firma o con firma alterada", async () => {
    const b = makeBilling();
    const { rawBody, signature } = b.provider.signEvent({ type: "subscription.canceled", data: { subscriptionId: b.repo.raw.subscriptions[0].id } });
    await expect(b.service.processWebhook(rawBody, null)).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(b.service.processWebhook(rawBody.replace("canceled", "cancelled"), signature)).rejects.toBeInstanceOf(WebhookSignatureError);
    expect(b.repo.raw.subscriptions[0].status).not.toBe("canceled");
  });
});

describe("transiciones inválidas", () => {
  it("el servicio se niega a renovar, reintentar o vencer gracia fuera de estado", async () => {
    const b = makeBilling();
    const canceled = b.repo.raw.subscriptions.find((s) => s.status === "canceled")!;
    await expect(b.service.runRenewal(canceled.id)).rejects.toBeInstanceOf(BillingError);
    const active = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    await expect(b.service.retryPayment(active.id)).rejects.toThrow(/No hay un cobro pendiente/);
    await expect(b.service.expireGracePeriod(active.id)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(b.repo.raw.subscriptions.find((s) => s.id === active.id)!.status).toBe("active");
  });

  it("no se cambia de plan con un pago vencido", async () => {
    const b = makeBilling();
    const sub = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    await b.service.runRenewal(sub.id, { outcome: "declined" });
    await expect(b.service.changePlan(ACTORS.laura, ORG.clinic, "profesional", "month", usage)).rejects.toThrow(/Regulariza el pago/);
  });
});

describe("integridad de registros", () => {
  it("datos de demostración coherentes: cuentas, importes y transiciones válidas", () => {
    const b = makeBilling();
    const d = b.repo.raw;
    const pairs = allowedStatusPairs();
    for (const s of d.subscriptions) expect(d.billing_accounts.some((a) => a.id === s.billing_account_id), s.id).toBe(true);
    for (const i of d.billing_invoices) {
      expect(i.subtotal_cents + i.tax_cents).toBe(i.amount_cents);
      expect(Number.isInteger(i.amount_cents)).toBe(true);
      expect(i.is_demo).toBe(true);
    }
    for (const e of d.subscription_events) if (e.from_status && e.to_status) expect(pairs.has(`${e.from_status}>${e.to_status}`), `${e.event_type} ${e.from_status}>${e.to_status}`).toBe(true);
    const current = d.subscriptions.filter((s) => s.workspace_id && !["canceled", "expired"].includes(s.status)).map((s) => s.workspace_id);
    expect(new Set(current).size).toBe(current.length);
    expect(d.billing_payment_methods.every((m) => /^\d{4}$/.test(m.last4))).toBe(true);
  });

  it("no permite dos suscripciones vigentes en el mismo espacio", async () => {
    const b = makeBilling();
    const existing = b.repo.raw.subscriptions.find((s) => s.workspace_id === ORG.clinic)!;
    await expect(b.repo.insertSubscription({ ...existing, id: crypto.randomUUID() })).rejects.toThrow(/duplicate_current_subscription/);
  });

  it("cada cambio de estado queda en el historial con origen y estados", async () => {
    const b = makeBilling();
    await subscribeNewOrg(b, "approved", "esencial");
    const events = (await b.service.listHistory(ACTORS.sofia, NEW_ORG)).reverse();
    expect(events.map((e) => [e.event_type, e.source, e.from_status, e.to_status])).toEqual([
      ["checkout_started", "user", "incomplete", "incomplete"],
      ["checkout_completed", "provider", "incomplete", "active"],
    ]);
    expect(events[1].provider_event_id).toMatch(/^evt_demo_/);
  });
});

describe("periodo de prueba para espacios nuevos", () => {
  it("un espacio creado desde Bienvenida inicia en prueba con el plan Profesional", async () => {
    const b = makeBilling();
    await b.service.startTrial(ACTORS.sofia, NEW_ORG, { name: "Consultorio Nuevo", email: "sofia@nueva.test", contactName: "Sofía", kind: "independent", timezone: "America/Mexico_City" });
    const ent = await b.service.getEntitlements(ACTORS.sofia, NEW_ORG);
    expect(ent).toMatchObject({ status: "trialing", access: "full" });
    expect(ent.plan?.code).toBe("profesional");
    // Contratar desde la prueba convierte la misma suscripción.
    const { sessionId } = await b.service.startCheckout(ACTORS.sofia, { workspaceId: NEW_ORG, planCode: "esencial", interval: "month", acceptedTerms: true, idempotencyKey: key() });
    await b.service.simulateCheckout(ACTORS.sofia, sessionId, "approved");
    expect(b.repo.raw.subscriptions.filter((s) => s.workspace_id === NEW_ORG).map((s) => [s.status, s.plan_id === b.repo.raw.plans[0].id])).toEqual([["active", true]]);
  });
});
