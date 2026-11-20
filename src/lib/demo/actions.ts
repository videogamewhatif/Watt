"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/session";
import { resetDemoStore } from "./data";
import { DEMO_COOKIE, DEMO_PERSONAS, isDemoEnabled } from "./personas";

/** Entra (o cambia de persona) en el modo de prueba con datos ficticios. */
export async function enterDemo(personaKey: string) {
  if (!isDemoEnabled()) redirect("/iniciar-sesion");
  const persona = DEMO_PERSONAS.find((p) => p.key === personaKey) ?? DEMO_PERSONAS[0];
  const store = await cookies();
  store.set(DEMO_COOKIE, persona.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  store.delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/inicio");
}

export async function exitDemo() {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  store.delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/iniciar-sesion");
}

/** Vuelve a los datos ficticios iniciales (fechas recalculadas a partir de hoy). */
export async function resetDemo() {
  if (!isDemoEnabled() || !(await cookies()).get(DEMO_COOKIE)) return;
  resetDemoStore();
  revalidatePath("/", "layout");
}
