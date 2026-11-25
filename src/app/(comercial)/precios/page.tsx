import { ArrowRight, BellRing, Building2, RefreshCcw, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { pricingFaq } from "@/features/billing/catalog";
import { PricingComparison } from "@/features/billing/components/pricing-comparison";
import { PricingExplorer } from "@/features/billing/components/pricing-explorer";
import { PricingFaq } from "@/features/billing/components/pricing-faq";
import { SalesLeadForm } from "@/features/billing/components/sales-lead-form";
import { intervalFromParam } from "@/features/billing/presenter";
import { loadPublicCatalog } from "@/features/billing/queries";

export const metadata: Metadata = {
  title: "Planes y precios",
  description: "Planes de Wattalis para consultorios, clínicas, centros médicos y hospitales. Facturación mensual o anual.",
};

const BENEFITS = [
  { Icon: ShieldCheck, title: "Tu información siempre es tuya", text: "Si cancelas o un pago se retrasa, nada se borra: pacientes, citas y cobros quedan disponibles para consulta y exportación." },
  { Icon: RefreshCcw, title: "Cambia de plan cuando quieras", text: "Las mejoras se aplican al momento y solo pagas la diferencia proporcional. Las reducciones esperan al final de tu periodo." },
  { Icon: Building2, title: "Cada clínica, por separado", text: "La suscripción pertenece a tu organización. Ninguna otra clínica puede ver tu información ni tu facturación." },
  { Icon: BellRing, title: "Sin cobros sorpresa", text: "Te avisamos antes de cada renovación y si un pago no se procesa. Ves el desglose completo antes de confirmar." },
];

export default async function PricingPage({ searchParams }: PageProps<"/precios">) {
  const { offers, plans, entitlements, settings, enabled } = await loadPublicCatalog();
  const initial = intervalFromParam((await searchParams).periodo);
  const featured = plans.find((p) => p.badge)?.code ?? null;

  return (
    <div className="pb-20">
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-brand-50 via-canvas to-canvas">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-brand-100/60 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 pt-14 pb-10 text-center sm:px-6 sm:pt-20">
          <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">Planes y precios</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink text-balance sm:text-5xl">Un plan para cada etapa de tu crecimiento</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-ink-soft text-pretty sm:text-lg">Desde tu primer consultorio hasta una red de clínicas. Wattalis crece contigo.</p>
          <p className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-950">
            Precios ilustrativos · {enabled ? "modo demostración, sin cobros reales" : "contratación en línea próximamente"}
          </p>
        </div>
      </section>

      <section aria-labelledby="planes" className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
        <h2 id="planes" className="sr-only">
          Planes
        </h2>
        <PricingExplorer offers={offers} discountBps={settings.annual_discount_bps} initialInterval={initial} />
        <p className="mt-6 text-center text-xs text-muted">
          {settings.prices_include_tax ? "Precios en pesos mexicanos con IVA incluido." : `Precios en pesos mexicanos más IVA (${settings.tax_rate_bps / 100} %).`} La facturación anual se cobra en un solo cargo; el
          precio mensual equivalente es solo una referencia. El descuento anual ({settings.annual_discount_bps / 100} %) es ilustrativo y puede cambiar.
        </p>
      </section>

      <section aria-labelledby="beneficios" className="mx-auto mt-20 max-w-7xl px-4 sm:px-6">
        <h2 id="beneficios" className="text-center text-2xl font-semibold tracking-tight text-ink">
          Pensado para la operación de salud
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ Icon, title, text }) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-5">
              <span className="inline-flex rounded-xl bg-brand-50 p-2 text-brand-700">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="comparativa" className="mx-auto mt-20 max-w-7xl px-4 sm:px-6">
        <div className="mb-6 text-center">
          <h2 id="comparativa" className="text-2xl font-semibold tracking-tight text-ink">
            Compara todas las funciones
          </h2>
          <p className="mt-1 text-sm text-muted">En el teléfono, desliza la tabla hacia los lados para ver todos los planes.</p>
        </div>
        <PricingComparison plans={plans} entitlements={entitlements} highlightCode={featured} />
      </section>

      <section id="corporativo" aria-labelledby="corporativo-titulo" className="mx-auto mt-20 max-w-7xl scroll-mt-24 px-4 sm:px-6">
        <div className="grid gap-8 rounded-3xl border border-brand-200 bg-brand-900 p-6 text-white sm:p-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand-200 uppercase">Planes empresariales</p>
            <h2 id="corporativo-titulo" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              ¿Un hospital o un grupo médico?
            </h2>
            <p className="mt-3 text-brand-100">
              El plan Corporativo reúne varias sedes bajo una sola cuenta, con límites a la medida, administración empresarial, facturación centralizada y
              condiciones comerciales particulares.
            </p>
          </div>
          <div className="rounded-2xl bg-surface p-5 text-ink sm:p-6">
            <SalesLeadForm />
          </div>
        </div>
      </section>

      <section aria-labelledby="faq" className="mx-auto mt-20 max-w-3xl px-4 sm:px-6">
        <h2 id="faq" className="mb-6 text-center text-2xl font-semibold tracking-tight text-ink">
          Preguntas frecuentes
        </h2>
        <PricingFaq items={pricingFaq(settings)} />
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4 text-center sm:px-6">
        <p className="text-lg font-medium text-ink">¿Listo para empezar?</p>
        <Link href="/suscripcion/seleccionar" className={buttonClass("primary", "md", "group mt-4")}>
          Elegir mi plan
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </section>
    </div>
  );
}
