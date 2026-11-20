import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/auth/forms";
import { safeNext } from "@/lib/redirects";
import { getAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignUpPage({ searchParams }: PageProps<"/registro">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next) : undefined;
  const { user } = await getAuthUser();
  if (user) redirect(next ?? "/inicio");
  return <SignUpForm next={next} />;
}
