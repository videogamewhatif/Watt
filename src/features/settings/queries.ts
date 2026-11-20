import "server-only";
import type { AppContext } from "@/lib/session";
import { formatInstant } from "@/lib/tz";
import type { InvitationItem, MemberItem } from "./components";

/** Miembros, invitaciones y perfiles sin cuenta (solo administración; RLS lo garantiza). */
export async function loadTeam(ctx: AppContext) {
  const [{ data: ms }, { data: profiles }, { data: invs }, { data: professionals }] = await Promise.all([
    ctx.supabase.from("memberships").select("id, user_id, role").eq("organization_id", ctx.workspace.id),
    ctx.supabase.from("profiles").select("id, full_name, email"),
    ctx.supabase.from("invitations").select("*").eq("organization_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(30),
    ctx.supabase.from("professionals").select("id, display_name, user_id, active").eq("organization_id", ctx.workspace.id).order("display_name"),
  ]);
  const members: MemberItem[] = (ms ?? [])
    .map((m) => {
      const p = profiles?.find((x) => x.id === m.user_id);
      return { membershipId: m.id, userId: m.user_id, name: p?.full_name || p?.email || "Sin nombre", email: p?.email ?? null, role: m.role, isSelf: m.user_id === ctx.user.id };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const now = Date.now();
  const profName = (id: string | null) => professionals?.find((p) => p.id === id)?.display_name ?? null;
  const invitations: InvitationItem[] = (invs ?? []).map((i) => {
    const status: InvitationItem["status"] = i.revoked_at ? "revocada" : i.accepted_at ? "aceptada" : new Date(i.expires_at).getTime() <= now ? "vencida" : "vigente";
    return {
      id: i.id,
      email: i.email,
      role: i.role,
      status,
      professional: profName(i.professional_id),
      expiresLabel:
        status === "aceptada" ? `aceptada el ${formatInstant(i.accepted_at!, ctx.workspace.timezone)}` : `vence el ${formatInstant(i.expires_at, ctx.workspace.timezone)}`,
    };
  });
  const unlinked = (professionals ?? []).filter((p) => !p.user_id && p.active).map((p) => ({ id: p.id, display_name: p.display_name }));
  return { members, invitations, unlinked };
}
