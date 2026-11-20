import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewPasswordForm } from "@/features/auth/forms";
import { getAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function ResetPasswordPage() {
  const { user } = await getAuthUser();
  if (!user) redirect("/recuperar");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Crea una nueva contraseña</h1>
        <p className="mt-1 text-sm text-muted">Para {user.email}</p>
      </div>
      <NewPasswordForm />
    </div>
  );
}
