import { FlaskConical, KeyRound, LogIn, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { SelectedPlanChip } from "@/features/billing/components/selected-plan-chip";
import { SubscriptionCheckoutStepper } from "@/features/billing/components/subscription-checkout-stepper";
import { resolveCheckoutPlan } from "@/features/billing/queries";
import { enterDemo } from "@/lib/demo/actions";
import { isDemoEnabled } from "@/lib/demo/personas";
import { hasSupabaseEnv } from "@/lib/env";
import { getAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "Crea tu cuenta" };

/**
 * Paso 2. Reutiliza el sistema de acceso existente (registro, inicio de sesión y
 * recuperación). No crea un sistema de cuentas paralelo.
 */
export default async function CheckoutAccountPage({ searchParams }: PageProps<"/suscripcion/registro">) {
  const { plan, interval, settings, query } = await resolveCheckoutPlan(await searchParams);
  if (!plan) redirect("/suscripcion/seleccionar");
  const next = `/suscripcion/organizacion?${query}`;
  const { user } = await getAuthUser();
  if (user) redirect(next);
  const encoded = encodeURIComponent(next);
  const configured = hasSupabaseEnv();

  return (
    <div className="animate-step-in">
      <SubscriptionCheckoutStepper current={2} />
      <SelectedPlanChip plan={plan} interval={interval} settings={settings} changeHref={`/suscripcion/seleccionar?${query}`} />
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Crea tu cuenta o inicia sesión</h1>
        <p className="mt-2 text-sm text-muted">Cada persona entra con su propia cuenta. La suscripción quedará a nombre de tu organización, no de tu cuenta personal.</p>
      </header>

      {!configured ? (
        <div className="mb-6">
          <Alert tone="warning" title="Acceso real aún no configurado">
            Este entorno todavía no tiene el servicio de cuentas conectado. Puedes continuar con una cuenta de prueba.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-line bg-surface p-6">
          <UserPlus className="size-6 text-brand-700" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold text-ink">Soy nuevo en Wattalis</h2>
          <p className="mt-1 flex-1 text-sm text-muted">Crea tu cuenta con tu correo. Después registrarás tu clínica o consultorio.</p>
          <Link href={`/registro?next=${encoded}`} className={buttonClass("primary", "md", "mt-5 w-full")}>
            Crear una cuenta
          </Link>
        </section>
        <section className="flex flex-col rounded-2xl border border-line bg-surface p-6">
          <LogIn className="size-6 text-brand-700" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold text-ink">Ya tengo cuenta</h2>
          <p className="mt-1 flex-1 text-sm text-muted">Inicia sesión para contratar en uno de tus espacios de trabajo o crear uno nuevo.</p>
          <Link href={`/iniciar-sesion?next=${encoded}`} className={buttonClass("secondary", "md", "mt-5 w-full")}>
            Iniciar sesión
          </Link>
          <Link href="/recuperar" className="mt-3 inline-flex items-center gap-1.5 self-center text-sm font-medium text-brand-700 hover:underline">
            <KeyRound className="size-4" aria-hidden />
            Recuperar mi contraseña
          </Link>
        </section>
      </div>

      {isDemoEnabled() ? (
        <section className="mt-6 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-5 text-amber-950">
          <h2 className="flex items-center gap-2 font-semibold">
            <FlaskConical className="size-4" aria-hidden />
            Probar sin registrarte (modo de prueba)
          </h2>
          <p className="mt-1 text-sm">Entra como «Sofía Navarro», una cuenta ficticia sin espacio de trabajo, y recorre la contratación completa con datos de demostración.</p>
          <form action={enterDemo.bind(null, "nueva", next)} className="mt-4">
            <Button type="submit" variant="secondary" icon={<FlaskConical className="size-4" aria-hidden />}>
              Continuar con una cuenta de prueba
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
