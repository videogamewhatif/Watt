import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui/layout";
import { NewPasswordForm } from "@/features/auth/forms";
import { Invitations, LeaveWorkspace, MembersList, ProfileForm, WorkspaceForm } from "@/features/settings/components";
import { loadTeam } from "@/features/settings/queries";
import { KIND_LABEL, ROLE_LABEL } from "@/lib/labels";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage({ searchParams }: PageProps<"/configuracion">) {
  const ctx = await getAppContext();
  const invitar = (await searchParams).invitar;
  const admin = ctx.can.manageWorkspace;

  const team = admin ? await loadTeam(ctx) : { members: [], invitations: [], unlinked: [] };
  const { members, invitations, unlinked } = team;
  const preselect = typeof invitar === "string" && unlinked.some((p) => p.id === invitar) ? invitar : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Configuración" description={`Espacio activo: ${ctx.workspace.name}`} />

      <Card>
        <CardHeader title="Espacio de trabajo" />
        <div className="p-5">
          {admin ? (
            <WorkspaceForm workspace={{ id: ctx.workspace.id, name: ctx.workspace.name, kind: ctx.workspace.kind, timezone: ctx.workspace.timezone, slotInterval: ctx.workspace.slotInterval }} />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Nombre</dt>
                <dd className="font-medium">{ctx.workspace.name}</dd>
              </div>
              <div>
                <dt className="text-muted">Tipo</dt>
                <dd className="font-medium">{KIND_LABEL[ctx.workspace.kind]}</dd>
              </div>
              <div>
                <dt className="text-muted">Tu rol</dt>
                <dd className="font-medium">{ROLE_LABEL[ctx.role]}</dd>
              </div>
            </dl>
          )}
        </div>
      </Card>

      {admin ? (
        <section id="miembros" className="scroll-mt-20">
          <Card>
            <CardHeader title="Miembros y roles" description="Cada persona entra con su propia cuenta. El espacio siempre conserva al menos un administrador." />
            <div className="space-y-6 p-5">
              <MembersList organizationId={ctx.workspace.id} members={members} />
              <Invitations organizationId={ctx.workspace.id} invitations={invitations} professionals={unlinked} preselectProfessionalId={preselect} />
            </div>
          </Card>
        </section>
      ) : null}

      <section id="mi-cuenta" className="scroll-mt-20">
        <Card>
          <CardHeader title="Mi cuenta" />
          <div className="space-y-6 p-5">
            <ProfileForm fullName={ctx.user.fullName} email={ctx.user.email} />
            <div className="border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold">Cambiar contraseña</h3>
              <NewPasswordForm stay />
            </div>
            {!admin ? (
              <div className="border-t border-line pt-5">
                <LeaveWorkspace organizationId={ctx.workspace.id} name={ctx.workspace.name} />
              </div>
            ) : null}
          </div>
        </Card>
      </section>
    </div>
  );
}
