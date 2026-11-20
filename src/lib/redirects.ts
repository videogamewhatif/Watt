/** Acepta solo rutas internas para redirigir después de iniciar sesión. */
export function safeNext(value: string | null | undefined, origin?: string): string {
  if (!value) return "/inicio";
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  if (origin) {
    try {
      const url = new URL(value);
      if (url.origin === origin) return `${url.pathname}${url.search}`;
    } catch {
      // ignorar valores que no son URL
    }
  }
  return "/inicio";
}

/**
 * Destino final de un enlace de correo. Con la plantilla token_hash, `next` trae la
 * URL de retorno completa (que a su vez apunta a /auth/confirm?next=…): se desenvuelve
 * para no volver a pasar por /auth/confirm sin token.
 */
export function resolveConfirmNext(value: string | null | undefined, origin: string): string {
  let next = safeNext(value, origin);
  for (let i = 0; i < 3 && next.startsWith("/auth/confirm"); i++) {
    next = safeNext(new URL(next, origin).searchParams.get("next"), origin);
  }
  return next;
}
