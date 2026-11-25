"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import { errorCode, errorMessage, logError } from "@/lib/errors";
import { MAX_AMOUNT, toCents } from "@/lib/money";
import { type AppContext, requireWorkspace, WORKSPACE_MISMATCH } from "@/lib/session";

const uuid = z.uuid("Identificador inválido.");
const money = (label: string) =>
  z
    .number({ error: `Escribe ${label}.` })
    .min(0, "No puede ser negativo.")
    .max(MAX_AMOUNT, "El importe es demasiado alto.")
    .refine((n) => Math.abs(n * 100 - toCents(n)) < 1e-6, "Usa máximo dos decimales.");
const note = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .transform((v) => v || null);

/** Para operar la caja hace falta rol de Administración o Recepción (la base de datos lo vuelve a exigir). */
async function cashContext(organizationId: string): Promise<{ denied: ActionResult<never>; ctx?: undefined } | { denied?: undefined; ctx: AppContext }> {
  const { ctx, mismatch } = await requireWorkspace(organizationId);
  if (mismatch) return { denied: fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" }) };
  if (!ctx.can.operateCash) return { denied: fail(errorMessage({ message: "forbidden" })) };
  return { ctx };
}

// ---------------------------------------------------------------------------
// Abrir turno
// ---------------------------------------------------------------------------
const openSchema = z.object({ organizationId: uuid, openingAmount: money("el fondo inicial"), notes: note(300) });

export async function openCashSession(input: z.input<typeof openSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const c = await cashContext(v.organizationId);
  if (c.denied) return c.denied;
  const { data, error } = await c.ctx.supabase.rpc("open_cash_session", { p_organization_id: v.organizationId, p_opening_amount: v.openingAmount, p_notes: v.notes });
  if (error || !data) {
    logError("open_cash_session", error);
    return fail(errorMessage(error), { code: errorCode(error) });
  }
  revalidatePath("/ventas", "layout");
  return ok({ id: data.id }, "Caja abierta. Ya puedes cobrar.");
}

// ---------------------------------------------------------------------------
// Cobrar
// ---------------------------------------------------------------------------
const chargeSchema = z.object({
  organizationId: uuid,
  contactId: uuid.nullable(),
  appointmentId: uuid.nullable(),
  items: z
    .array(
      z.object({
        serviceId: uuid.nullable(),
        description: z.string().trim().max(160, "Máximo 160 caracteres."),
        quantity: z.number().int("Usa cantidades enteras.").min(1, "Mínimo 1.").max(999, "Máximo 999."),
        unitPrice: money("el precio"),
      }),
    )
    .min(1, "Agrega al menos un concepto.")
    .max(50, "Máximo 50 conceptos por cobro."),
  discount: money("el descuento"),
  payments: z
    .array(
      z.object({
        method: z.enum(["cash", "card", "transfer"]),
        amount: z.number().positive("El pago debe ser mayor a cero.").max(MAX_AMOUNT).refine((n) => Math.abs(n * 100 - toCents(n)) < 1e-6, "Usa máximo dos decimales."),
        reference: note(80),
      }),
    )
    .min(1, "Registra al menos una forma de pago.")
    .max(10),
  notes: note(300),
  idempotencyKey: uuid,
});

export type ChargeResult = { id: string; folio: number; total: number };

export async function createCharge(input: z.input<typeof chargeSchema>): Promise<ActionResult<ChargeResult>> {
  const parsed = chargeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Revisa los datos del cobro.");
  const v = parsed.data;
  if (v.items.some((i) => !i.serviceId && i.description.length < 2)) return fail("Escribe la descripción de cada concepto libre.");
  const c = await cashContext(v.organizationId);
  if (c.denied) return c.denied;
  const { data, error } = await c.ctx.supabase.rpc("create_charge", {
    p_organization_id: v.organizationId,
    p_items: v.items.map((i) => ({ service_id: i.serviceId, description: i.description, quantity: i.quantity, unit_price: i.unitPrice })),
    p_payments: v.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
    p_discount: v.discount,
    p_contact_id: v.contactId,
    p_appointment_id: v.appointmentId,
    p_notes: v.notes,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error || !data) {
    logError("create_charge", error);
    const code = errorCode(error);
    // Si el precio de lista cambió mientras se capturaba, el servidor manda su total.
    const message = code === "payment_mismatch" ? "El total cambió (por ejemplo, se actualizó un precio). Cierra y vuelve a abrir el cobro." : errorMessage(error);
    return fail(message, { code });
  }
  revalidatePath("/ventas", "layout");
  return ok({ id: data.id, folio: data.folio, total: data.total }, `Cobro #${data.folio} registrado.`);
}

// ---------------------------------------------------------------------------
// Cancelar un cobro
// ---------------------------------------------------------------------------
const voidSchema = z.object({
  organizationId: uuid,
  chargeId: uuid,
  reason: z.string().trim().min(3, "Escribe el motivo (mínimo 3 caracteres).").max(200, "Máximo 200 caracteres."),
});

export async function voidCharge(input: z.input<typeof voidSchema>): Promise<ActionResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const { ctx, mismatch } = await requireWorkspace(v.organizationId);
  if (mismatch) return fail(WORKSPACE_MISMATCH, { code: "workspace_mismatch" });
  if (!ctx.can.voidCharges) return fail(errorMessage({ message: "forbidden" }));
  const { error } = await ctx.supabase.rpc("void_charge", { p_charge_id: v.chargeId, p_reason: v.reason });
  if (error) {
    logError("void_charge", error);
    return fail(errorMessage(error), { code: errorCode(error) });
  }
  revalidatePath("/ventas", "layout");
  return ok(undefined, "Cobro cancelado.");
}

// ---------------------------------------------------------------------------
// Entradas y salidas de efectivo
// ---------------------------------------------------------------------------
const movementSchema = z.object({
  organizationId: uuid,
  kind: z.enum(["in", "out"]),
  amount: money("el monto").refine((n) => n > 0, "El monto debe ser mayor a cero."),
  concept: z.string().trim().min(3, "Escribe el concepto (mínimo 3 caracteres).").max(160, "Máximo 160 caracteres."),
});

export async function addCashMovement(input: z.input<typeof movementSchema>): Promise<ActionResult> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const c = await cashContext(v.organizationId);
  if (c.denied) return c.denied;
  const { error } = await c.ctx.supabase.rpc("add_cash_movement", { p_organization_id: v.organizationId, p_kind: v.kind, p_amount: v.amount, p_concept: v.concept });
  if (error) {
    logError("add_cash_movement", error);
    return fail(errorMessage(error), { code: errorCode(error) });
  }
  revalidatePath("/ventas", "layout");
  return ok(undefined, v.kind === "in" ? "Entrada de efectivo registrada." : "Salida de efectivo registrada.");
}

// ---------------------------------------------------------------------------
// Corte
// ---------------------------------------------------------------------------
const closeSchema = z.object({ organizationId: uuid, sessionId: uuid, countedAmount: money("el efectivo contado"), notes: note(300) });

export type CloseResult = { expected: number; counted: number; difference: number };

export async function closeCashSession(input: z.input<typeof closeSchema>): Promise<ActionResult<CloseResult>> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  const v = parsed.data;
  const c = await cashContext(v.organizationId);
  if (c.denied) return c.denied;
  const { data, error } = await c.ctx.supabase.rpc("close_cash_session", { p_session_id: v.sessionId, p_counted_amount: v.countedAmount, p_notes: v.notes });
  if (error || !data) {
    logError("close_cash_session", error);
    const code = errorCode(error);
    return fail(errorMessage(error), { code, fieldErrors: code === "difference_needs_note" ? { notes: "Explica la diferencia." } : undefined });
  }
  revalidatePath("/ventas", "layout");
  return ok({ expected: data.expected_cash ?? 0, counted: data.counted_cash ?? 0, difference: data.difference ?? 0 }, "Caja cerrada.");
}
