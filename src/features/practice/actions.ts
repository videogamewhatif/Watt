"use server";

import { cookies } from "next/headers";
import { ALL_AREAS, isPracticeKey, PRACTICE_COOKIE } from "@/lib/practice";

/** Guarda el área elegida en la barra lateral (por navegador). */
export async function setPracticeArea(area: string) {
  const store = await cookies();
  if (area === ALL_AREAS || !isPracticeKey(area)) {
    store.delete(PRACTICE_COOKIE);
    return;
  }
  store.set(PRACTICE_COOKIE, area, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
