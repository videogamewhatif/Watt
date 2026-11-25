// Contrato de identidad para la migración futura a Amazon Cognito.
//
// Hoy el acceso lo resuelven Supabase Auth (src/features/auth/actions.ts,
// src/lib/session.ts) y el modo de prueba. No se duplica: este archivo solo fija
// la interfaz que deberá cumplir cualquier proveedor para que el resto de la
// aplicación (incluida la contratación de planes) no cambie al migrar.
//
// Puntos de acoplamiento actuales con Supabase que el adaptador debe cubrir:
//   * getAuthUser()            → currentUser()
//   * signIn / signUp          → signIn / signUp (con confirmación por correo)
//   * requestPasswordReset     → requestPasswordReset / confirmPasswordReset
//   * auth.uid() en RLS        → claim `sub` del token de Cognito, propagado a
//                                PostgreSQL (RDS) con set_config('request.jwt.claims', …)
//                                como ya hace tests/db/helpers.ts
//   * platform_admins          → grupo de Cognito «wattalis-platform» o la tabla
//                                platform_admins (se recomienda conservar la tabla)

export type IdentityUser = {
  /** Identificador estable (sub). Se usa como user_id en memberships y platform_admins. */
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
};

export type SignUpResult = { status: "signed_in" } | { status: "confirmation_required" };

export interface IdentityProvider {
  readonly name: "supabase" | "cognito" | "demo";
  currentUser(): Promise<IdentityUser | null>;
  signIn(input: { email: string; password: string }): Promise<{ ok: true } | { ok: false; reason: "invalid_credentials" | "email_not_confirmed" | "unknown" }>;
  signUp(input: { email: string; password: string; fullName: string; redirectTo: string }): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestPasswordReset(input: { email: string; redirectTo: string }): Promise<void>;
  confirmPasswordReset(input: { email: string; code: string; newPassword: string }): Promise<void>;
}

/**
 * Adaptador FUTURO para Amazon Cognito (User Pool + App Client sin secreto en el
 * navegador; flujo con Hosted UI o SRP desde el servidor). Deshabilitado.
 *
 * Variables previstas (solo servidor): COGNITO_REGION, COGNITO_USER_POOL_ID,
 * COGNITO_CLIENT_ID, COGNITO_DOMAIN. Los tokens se guardan en cookies httpOnly.
 */
export class CognitoIdentityProvider implements IdentityProvider {
  readonly name = "cognito" as const;
  constructor(private readonly config: { region?: string; userPoolId?: string; clientId?: string } = {}) {}
  private notEnabled(): never {
    throw new Error(
      `Amazon Cognito aún no está habilitado${this.config.userPoolId ? "" : " (falta COGNITO_USER_POOL_ID)"}. El acceso sigue usando el proveedor actual.`,
    );
  }
  async currentUser(): Promise<IdentityUser | null> {
    return this.notEnabled();
  }
  async signIn(): Promise<{ ok: true }> {
    return this.notEnabled();
  }
  async signUp(): Promise<SignUpResult> {
    return this.notEnabled();
  }
  async signOut(): Promise<void> {
    return this.notEnabled();
  }
  async requestPasswordReset(): Promise<void> {
    return this.notEnabled();
  }
  async confirmPasswordReset(): Promise<void> {
    return this.notEnabled();
  }
}
