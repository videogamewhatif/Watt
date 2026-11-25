import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { checkFeature } from "@/features/billing/entitlements";
import { getWorkspaceEntitlements } from "@/features/billing/server";
import { availableAreas, PRACTICE_COOKIE, type PracticeArea, type PracticeKey, resolveArea } from "@/lib/practice";
import { getAppContext } from "@/lib/session";

/**
 * Áreas del espacio activo y el área elegida (null = todas). Una vez por solicitud.
 * Si el plan no incluye «Gestión de diferentes áreas médicas», no se filtra por
 * área (se ve todo); un área guardada antes no deja la agenda filtrada a escondidas.
 */
export const getPracticeContext = cache(async (): Promise<{ areas: PracticeArea[]; active: PracticeKey | null; multiAreaEnabled: boolean }> => {
  const ctx = await getAppContext();
  const multiAreaEnabled = checkFeature(await getWorkspaceEntitlements(), "areas.multiple").allowed;
  const { data } = await ctx.supabase
    .from("professionals")
    .select("professional_type")
    .eq("organization_id", ctx.workspace.id)
    .eq("active", true);
  const areas = availableAreas((data ?? []).map((p) => p.professional_type)).map((a) => ({ key: a.key, label: a.label, color: a.color }));
  const saved = (await cookies()).get(PRACTICE_COOKIE)?.value;
  return { areas, active: multiAreaEnabled ? resolveArea(saved, areas) : null, multiAreaEnabled };
});
