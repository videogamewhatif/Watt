import type { Metadata } from "next";
import { AgendaScreen } from "@/features/agenda/components/agenda-screen";
import { parseAgendaQuery } from "@/features/agenda/params";
import { loadAgenda } from "@/features/agenda/queries";
import { getAppContext } from "@/lib/session";
import { todayIn } from "@/lib/tz";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  const ctx = await getAppContext();
  const query = parseAgendaQuery(await searchParams, todayIn(ctx.workspace.timezone));
  const data = await loadAgenda(ctx, query);
  return (
    <AgendaScreen
      data={data}
      query={query}
      canSeeAll={ctx.can.allAppointments}
      canManageCatalog={ctx.can.manageCatalog}
      ownProfessionalId={ctx.ownProfessionalId}
    />
  );
}
