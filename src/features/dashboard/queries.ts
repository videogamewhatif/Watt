import "server-only";
import type { AppointmentStatus } from "@/lib/database.types";
import { logError } from "@/lib/errors";
import type { AppContext } from "@/lib/session";

export type DashboardSummary = {
  today: string;
  timezone: string;
  today_total: number;
  today_pending: number;
  today_confirmed: number;
  today_attended: number;
  today_no_show: number;
  today_cancelled: number;
  upcoming_pending: number;
  next_appointment: {
    id: string;
    local_start: string;
    status: AppointmentStatus;
    contact_name: string;
    service_name: string;
    professional_name: string;
  } | null;
  setup: { has_professional: boolean; has_service: boolean; has_assignment: boolean; has_schedule: boolean; has_appointment: boolean };
};

export async function loadDashboard(ctx: AppContext): Promise<DashboardSummary | null> {
  const { data, error } = await ctx.supabase.rpc("dashboard_summary", { p_organization_id: ctx.workspace.id });
  if (error || !data) {
    logError("dashboard_summary", error);
    return null;
  }
  return data as unknown as DashboardSummary;
}
