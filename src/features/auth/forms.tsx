"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";
import { requestPasswordReset, signIn, signUp, updatePassword } from "./actions";

function errorFor(state: ActionResult<unknown> | null, field: string) {
  return state && !state.ok ? state.fieldErrors?.[field] : undefined;
}

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  const [email, setEmail] = useState("");
  const register = next ? `/registro?next=${encodeURIComponent(next)}` : "/registro";
  return (
    <form action={action} className="space-y-5" noValidate>
      <h1 className="text-xl font-semibold">Iniciar sesión</h1>
      {notice ? <Alert tone="warning">{notice}</Alert> : null}
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <TextField label="Correo" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errorFor(state, "email")} />
      <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required error={errorFor(state, "password")} />
      <Button type="submit" pending={pending} className="w-full">
        Entrar
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/recuperar" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Olvidé mi contraseña
        </Link>
        <Link href={register} className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Crear una cuenta
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signUp, null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Revisa tu correo</h1>
        <p className="text-sm text-ink-soft">
          Te enviamos un enlace para confirmar tu cuenta. Ábrelo desde este dispositivo para continuar. Si no lo encuentras, revisa la carpeta de
          spam.
        </p>
        <Link href="/iniciar-sesion" className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }
  const login = next ? `/iniciar-sesion?next=${encodeURIComponent(next)}` : "/iniciar-sesion";
  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Crear una cuenta</h1>
        <p className="mt-1 text-sm text-muted">Cada persona usa su propia cuenta. Después podrás crear tu espacio o aceptar una invitación.</p>
      </div>
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <TextField label="Nombre completo" name="fullName" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} error={errorFor(state, "fullName")} />
      <TextField label="Correo" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errorFor(state, "email")} />
      <TextField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Al menos 8 caracteres."
        error={errorFor(state, "password")}
      />
      <TextField label="Confirma la contraseña" name="confirm" type="password" autoComplete="new-password" required error={errorFor(state, "confirm")} />
      <Button type="submit" pending={pending} className="w-full">
        Crear cuenta
      </Button>
      <p className="text-sm text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href={login} className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Recuperar contraseña</h1>
        <p className="mt-1 text-sm text-muted">Te enviaremos un enlace para crear una nueva contraseña.</p>
      </div>
      {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <TextField label="Correo" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errorFor(state, "email")} />
      <Button type="submit" pending={pending} className="w-full">
        Enviar enlace
      </Button>
      <Link href="/iniciar-sesion" className="block text-sm font-medium text-brand-700 underline-offset-4 hover:underline">
        Volver a iniciar sesión
      </Link>
    </form>
  );
}

export function NewPasswordForm({ stay = false }: { stay?: boolean }) {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="redirectTo" value={stay ? "stay" : ""} />
      <TextField
        label="Nueva contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Al menos 8 caracteres."
        error={errorFor(state, "password")}
      />
      <TextField label="Confirma la contraseña" name="confirm" type="password" autoComplete="new-password" required error={errorFor(state, "confirm")} />
      <Button type="submit" pending={pending} className={stay ? "" : "w-full"}>
        Guardar contraseña
      </Button>
    </form>
  );
}
