import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { resolveConfirmNext } from "@/lib/redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de los enlaces de correo (confirmación de cuenta y recuperación de
 * contraseña). Acepta el formato token_hash (recomendado, funciona en cualquier
 * navegador) y el formato code de PKCE.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = resolveConfirmNext(searchParams.get("next"), origin);
  if (!hasSupabaseEnv()) return NextResponse.redirect(new URL("/iniciar-sesion", origin));

  const supabase = await createClient();
  let failed = true;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = Boolean(error);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  }

  if (failed) {
    return NextResponse.redirect(new URL("/iniciar-sesion?error=enlace", origin));
  }
  const destination = type === "recovery" ? "/restablecer" : next;
  return NextResponse.redirect(new URL(destination, origin));
}
