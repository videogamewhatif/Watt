"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, fail, fieldErrorsFrom, ok } from "@/lib/action-result";
import { safeNext } from "@/lib/redirects";
import { DEMO_COOKIE } from "@/lib/demo/personas";
import { hasSupabaseEnv } from "@/lib/env";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/session";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

const email = z.email("Escribe un correo válido.").transform((v) => v.trim().toLowerCase());
const password = z.string().min(8, "Usa al menos 8 caracteres.").max(72, "Usa como máximo 72 caracteres.");

const NOT_CONFIGURED = "Aún no hay un proyecto de Supabase conectado. Usa «Pruebas» para recorrer la interfaz con datos ficticios.";

const signInSchema = z.object({ email, password: z.string().min(1, "Escribe tu contraseña.") });

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({ email: String(formData.get("email") ?? "").trim(), password: formData.get("password") });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  if (!hasSupabaseEnv()) return fail(NOT_CONFIGURED);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return fail("Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.");
    }
    if (error.code === "invalid_credentials") return fail("Correo o contraseña incorrectos.");
    return fail("No pudimos iniciar sesión. Intenta de nuevo en unos minutos.");
  }
  redirect(safeNext(String(formData.get("next") ?? "")));
}

const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, "Escribe tu nombre.").max(120, "El nombre es demasiado largo."),
    email,
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." });

export async function signUp(_prev: ActionResult<{ needsConfirmation: boolean }> | null, formData: FormData): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: String(formData.get("email") ?? "").trim(),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });

  if (!hasSupabaseEnv()) return fail(NOT_CONFIGURED);
  const next = safeNext(String(formData.get("next") ?? ""));
  const site = await getSiteUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${site}/auth/confirm?next=${encodeURIComponent(next === "/inicio" ? "/bienvenida" : next)}`,
    },
  });
  if (error) {
    if (error.code === "weak_password") return fail("La contraseña es demasiado débil.", { fieldErrors: { password: "Elige una contraseña más segura." } });
    if (error.code === "user_already_exists") return fail("Ya existe una cuenta con ese correo. Inicia sesión.");
    if (error.code === "over_email_send_rate_limit") return fail("Se enviaron demasiados correos. Espera unos minutos.");
    return fail("No pudimos crear la cuenta. Intenta de nuevo.");
  }
  if (data.session) redirect(next === "/inicio" ? "/bienvenida" : next);
  // Supabase no revela si el correo ya existía: se muestra el mismo mensaje.
  return ok({ needsConfirmation: true });
}

export async function requestPasswordReset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = email.safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) return fail("Revisa el correo.", { fieldErrors: { email: parsed.error.issues[0].message } });
  if (!hasSupabaseEnv()) return fail(NOT_CONFIGURED);
  const site = await getSiteUrl();
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${site}/auth/confirm?next=/restablecer` });
  // Mismo mensaje exista o no la cuenta.
  return ok(undefined, "Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña.");
}

const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." });

export async function updatePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return fail("Revisa los campos marcados.", { fieldErrors: fieldErrorsFrom(parsed.error.issues) });
  if ((await cookies()).get(DEMO_COOKIE)) return fail("No disponible en el modo de prueba.");
  if (!hasSupabaseEnv()) return fail(NOT_CONFIGURED);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return fail("La nueva contraseña debe ser distinta de la anterior.");
    if (error.code === "weak_password") return fail("La contraseña es demasiado débil.");
    return fail("No pudimos actualizar la contraseña. Solicita un enlace nuevo.");
  }
  const redirectTo = String(formData.get("redirectTo") ?? "");
  if (redirectTo === "stay") return ok(undefined, "Contraseña actualizada.");
  redirect("/inicio");
}

export async function signOut() {
  const store = await cookies();
  if (!store.get(DEMO_COOKIE) && hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  store.delete(DEMO_COOKIE);
  store.delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/iniciar-sesion");
}
