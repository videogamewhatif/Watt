import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Wordmark } from "@/components/ui/layout";
import { signOut } from "@/features/auth/actions";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/labels";
import { getAuthUser } from "@/lib/session";
import { AcceptInvitationButton } from "./accept-button";

export const metadata: Metadata = { title: "Invitación" };

const STATUS_MESSAGE = {
  expired: "Esta invitación venció. Pide a la administración un enlace nuevo.",
  used: "Esta invitación ya se utilizó.",
  revoked: "Esta invitación fue revocada. Pide un enlace nuevo.",
  invalid: "El enlace de invitación no es válido. Revisa que esté completo.",
} as const;

export default async function InvitationPage({ params }: PageProps<"/invitacion/[token]">) {
  const { token } = await params;
  const { supabase, user } = await getAuthUser();
  if (!user) redirect(`/iniciar-sesion?next=${encodeURIComponent(`/invitacion/${token}`)}`);

  const { data } = await supabase.rpc("get_invitation", { p_token: token });
  const invitation = data?.[0];

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Wordmark className="text-3xl" />
        </div>
        <div className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold">Invitación a un espacio de trabajo</h1>
          {!invitation || invitation.status !== "valid" ? (
            <Alert tone="error">{STATUS_MESSAGE[(invitation?.status ?? "invalid") as keyof typeof STATUS_MESSAGE]}</Alert>
          ) : (
            <>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Espacio</dt>
                  <dd className="font-semibold">{invitation.organization_name}</dd>
                </div>
                <div>
                  <dt className="text-muted">Rol</dt>
                  <dd>
                    <span className="font-semibold">{invitation.role ? ROLE_LABEL[invitation.role] : ""}</span>
                    <span className="block text-muted">{invitation.role ? ROLE_DESCRIPTION[invitation.role] : ""}</span>
                  </dd>
                </div>
              </dl>
              {invitation.email_matches ? (
                <AcceptInvitationButton token={token} />
              ) : (
                <Alert tone="warning" title="Esta invitación es para otro correo">
                  Fue enviada a <strong>{invitation.email_hint}</strong> y tu sesión es de <strong>{user.email}</strong>. Cierra sesión e ingresa (o
                  crea tu cuenta) con el correo invitado.
                </Alert>
              )}
            </>
          )}
          <div className="flex justify-between gap-3 border-t border-line pt-4 text-sm">
            <Link href="/inicio" className="font-medium text-brand-700 hover:underline">
              Ir a Wattalis
            </Link>
            <form action={signOut}>
              <button type="submit" className="font-medium text-muted hover:text-ink hover:underline">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
