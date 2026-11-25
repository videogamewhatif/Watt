import "server-only";
import type { AppContext } from "@/lib/session";
import { addDays, formatShortDate, todayIn } from "@/lib/tz";

/** Horario semanal y bloqueos de los próximos 180 días, listos para los editores. */
export async function loadSchedule(ctx: AppContext, professionalId: string) {
  const today = todayIn(ctx.workspace.timezone);
  const [{ data: rules }, { data: blocks }] = await Promise.all([
    ctx.supabase.from("availability_rules").select("weekday, start_time, end_time").eq("professional_id", professionalId),
    ctx.supabase.rpc("agenda_time_off", { p_organization_id: ctx.workspace.id, p_from: today, p_to: addDays(today, 180), p_professional_id: professionalId }),
  ]);
  const blockItems = (blocks ?? []).map((b) => {
    const sameDay = b.local_start.slice(0, 10) === b.local_end.slice(0, 10);
    const allDay = b.local_start.endsWith("00:00") && b.local_end.endsWith("00:00");
    const label = allDay
      ? `${formatShortDate(b.local_start.slice(0, 10))} – ${formatShortDate(addDays(b.local_end.slice(0, 10), -1))} (días completos)`
      : sameDay
        ? `${formatShortDate(b.local_start.slice(0, 10))}, ${b.local_start.slice(11)}–${b.local_end.slice(11)}`
        : `${formatShortDate(b.local_start.slice(0, 10))} ${b.local_start.slice(11)} – ${formatShortDate(b.local_end.slice(0, 10))} ${b.local_end.slice(11)}`;
    return { id: b.id, kind: b.kind, note: b.note, label };
  });
  return { today, rules: rules ?? [], blockItems };
}
