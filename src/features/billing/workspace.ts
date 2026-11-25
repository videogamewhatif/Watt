import "server-only";
import { cache } from "react";
import { getAppContext } from "@/lib/session";
import { quote } from "./pricing";
import { countUsage, getBillingActor, getBillingService, isBillingActive } from "./server";

/** Todo lo de «Suscripción y facturación» del espacio activo (una vez por solicitud). Solo Administración. */
export const loadWorkspaceBilling = cache(async () => {
  const ctx = await getAppContext();
  if (!(await isBillingActive()) || !ctx.can.manageBilling) return null;
  const actor = (await getBillingActor())!;
  const service = getBillingService();
  const [overview, usage, catalog] = await Promise.all([service.getOverview(actor, ctx.workspace.id), countUsage(ctx), service.getCatalog()]);
  const offers = catalog.plans
    .filter((p) => !p.is_custom_pricing)
    .map((p) => ({ code: p.code, name: p.name, tier: p.tier, quotes: { month: quote(p, "month", catalog.settings), year: quote(p, "year", catalog.settings) } }));
  return { ctx, actor, service, overview, usage, catalog, offers };
});

export type WorkspaceBilling = NonNullable<Awaited<ReturnType<typeof loadWorkspaceBilling>>>;

export function formatDate(iso: string | null | undefined, tz: string, style: "long" | "medium" = "long") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: style, timeZone: tz }).format(new Date(iso));
}

export function formatDateTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));
}
