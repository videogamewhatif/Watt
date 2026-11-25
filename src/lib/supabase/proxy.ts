import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { DEMO_COOKIE, demoPersona } from "@/lib/demo/personas";
import { hasSupabaseEnv, supabaseEnv } from "@/lib/env";

// /precios, los dos primeros pasos de la contratación y el catálogo de planes
// (lo consume el sitio público) se ven sin sesión; el webhook de la pasarela
// llega sin sesión y se autentica con su firma.
const PUBLIC_PATHS = ["/iniciar-sesion", "/registro", "/recuperar", "/auth", "/precios", "/suscripcion/seleccionar", "/suscripcion/registro", "/api/billing/webhook", "/api/billing/catalog"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Renueva la sesión de Supabase y protege las páginas internas. */
function redirectToLogin(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const login = request.nextUrl.clone();
  login.pathname = "/iniciar-sesion";
  login.search = "";
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export async function updateSession(request: NextRequest) {
  // Modo de prueba: datos ficticios en memoria, sin sesión de Supabase.
  if (demoPersona(request.cookies.get(DEMO_COOKIE)?.value)) return NextResponse.next({ request });
  if (!hasSupabaseEnv()) {
    return isPublicPath(request.nextUrl.pathname) ? NextResponse.next({ request }) : redirectToLogin(request);
  }

  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [header, value] of Object.entries(headers ?? {})) response.headers.set(header, value);
      },
    },
  });

  // No insertar código entre createServerClient y getClaims(): renueva el token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  if (!signedIn && !isPublicPath(request.nextUrl.pathname)) {
    const redirect = redirectToLogin(request);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}
