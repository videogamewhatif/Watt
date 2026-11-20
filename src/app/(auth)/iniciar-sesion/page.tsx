import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoEntry } from "@/features/auth/demo-entry";
import { SignInForm } from "@/features/auth/forms";
import { isDemoEnabled } from "@/lib/demo/personas";
import { hasSupabaseEnv } from "@/lib/env";
import { safeNext } from "@/lib/redirects";
import { getAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function SignInPage({ searchParams }: PageProps<"/iniciar-sesion">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next) : undefined;
  const { user } = await getAuthUser();
  if (user) redirect(next ?? "/inicio");
  const notice = params.error === "enlace" ? "El enlace no es válido o ya venció. Solicita uno nuevo." : undefined;
  return (
    <>
      <SignInForm next={next} notice={notice} />
      {isDemoEnabled() ? <DemoEntry configured={hasSupabaseEnv()} /> : null}
    </>
  );
}
