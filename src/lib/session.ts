import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import type { MemberRole, OrganizationKind } from "@/lib/database.types";
import { createDemoClient } from "@/lib/demo/client";
import { DEMO_COOKIE, type DemoPersona, demoPersona } from "@/lib/demo/personas";
import { hasSupabaseEnv } from "@/lib/env";
import { permissionsFor, type Permissions } from "@/lib/permissions";
import { createClient, type ServerClient } from "@/lib/supabase/server";

/**
 * Cookie con el espacio de trabajo elegido. Solo sirve para navegar: en cada
 * solicitud se comprueba contra las membresías reales de la cuenta, y la
 * autorización de cada operación la hace RLS en la base de datos.
 */
export const ACTIVE_WORKSPACE_COOKIE = "wattalis_espacio";

export type Workspace = {
  id: string;
  membershipId: string;
  name: string;
  kind: OrganizationKind;
  timezone: string;
  slotInterval: number;
  role: MemberRole;
};

export type AppContext = {
  supabase: ServerClient;
  user: { id: string; email: string; fullName: string };
  workspaces: Workspace[];
  workspace: Workspace;
  role: MemberRole;
  can: Permissions;
  /** Perfil profesional de la cuenta en el espacio activo (si atiende consultas). */
  ownProfessionalId: string | null;
};

/** Cliente que solo existe para tipar: sin Supabase configurado nunca hay usuario que lo use. */
const unconfigured = new Proxy({} as ServerClient, {
  get() {
    throw new Error("Supabase no está configurado. Completa .env.local (ver .env.example).");
  },
});

/**
 * Usuario autenticado verificado con Supabase Auth (una vez por solicitud).
 * En modo de prueba devuelve la persona ficticia y un cliente en memoria.
 */
export const getAuthUser = cache(async (): Promise<{ supabase: ServerClient; user: User | null; demo: DemoPersona | null }> => {
  const demo = demoPersona((await cookies()).get(DEMO_COOKIE)?.value);
  if (demo) {
    const user = { id: demo.id, email: demo.email, user_metadata: { full_name: demo.name } } as unknown as User;
    return { supabase: createDemoClient(demo.id), user, demo };
  }
  if (!hasSupabaseEnv()) return { supabase: unconfigured, user: null, demo: null };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : data.user, demo: null };
});

export const getWorkspaces = cache(async (): Promise<{ supabase: ServerClient; userId: string | null; workspaces: Workspace[] }> => {
  const { supabase, user } = await getAuthUser();
  if (!user) return { supabase, userId: null, workspaces: [] };
  const { data } = await supabase
    .from("memberships")
    .select("id, role, organization:organizations(id, name, kind, timezone, slot_interval_minutes)")
    .eq("user_id", user.id);
  const workspaces: Workspace[] = (data ?? [])
    .filter((m) => m.organization)
    .map((m) => ({
      id: m.organization!.id,
      membershipId: m.id,
      name: m.organization!.name,
      kind: m.organization!.kind,
      timezone: m.organization!.timezone,
      slotInterval: m.organization!.slot_interval_minutes,
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { supabase, userId: user.id, workspaces };
});

/**
 * Contexto de las páginas internas: cuenta, espacio activo, rol y permisos.
 * Redirige a iniciar sesión o a crear un espacio cuando corresponde.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const { supabase, user } = await getAuthUser();
  if (!user) redirect("/iniciar-sesion");
  const { workspaces } = await getWorkspaces();
  if (workspaces.length === 0) redirect("/bienvenida");

  const preferred = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const workspace = workspaces.find((w) => w.id === preferred) ?? workspaces[0];

  const [{ data: profile }, { data: own }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    supabase.from("professionals").select("id").eq("organization_id", workspace.id).eq("user_id", user.id).maybeSingle(),
  ]);

  return {
    supabase,
    user: {
      id: user.id,
      email: user.email ?? profile?.email ?? "",
      fullName: profile?.full_name || user.email?.split("@")[0] || "",
    },
    workspaces,
    workspace,
    role: workspace.role,
    can: permissionsFor(workspace.role),
    ownProfessionalId: own?.id ?? null,
  };
});

/**
 * Para Server Actions: exige que la acción se refiera al espacio activo. Evita que
 * un formulario abierto en otra pestaña, antes de cambiar de espacio, escriba en
 * el espacio equivocado. (La autorización real la sigue haciendo RLS.)
 */
export async function requireWorkspace(organizationId: string | null | undefined) {
  const ctx = await getAppContext();
  if (organizationId && organizationId !== ctx.workspace.id) {
    return { ctx, mismatch: true as const };
  }
  return { ctx, mismatch: false as const };
}

export const WORKSPACE_MISMATCH = "Cambiaste de espacio de trabajo en otra pestaña. Recarga la página para continuar.";
