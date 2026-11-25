// Utilidades para probar el servicio de suscripciones con datos ficticios y un reloj controlado.
import { InMemoryBillingRepository } from "@/features/billing/memory-repository";
import { DemoInboxSender } from "@/features/billing/notifications";
import { MockBillingProvider } from "@/features/billing/providers/mock";
import { DEMO_ORG, buildBillingSeed } from "@/features/billing/seed";
import { BillingService } from "@/features/billing/service";
import type { Actor } from "@/features/billing/types";

export const ORG = DEMO_ORG;
export const NEW_ORG = "b0000000-0000-4000-8000-0000000000aa";

export function makeBilling(start = new Date("2026-11-24T18:00:00Z")) {
  let clock = start;
  const seed = () => buildBillingSeed(clock, "http://wattalis.test");
  const repo = new InMemoryBillingRepository(seed(), seed);
  const provider = new MockBillingProvider();
  const service = new BillingService({ repo, provider, sender: new DemoInboxSender(), appUrl: "http://wattalis.test", now: () => clock });
  return {
    service,
    repo,
    provider,
    advance(days: number) {
      clock = new Date(clock.getTime() + days * 86_400_000);
    },
    get now() {
      return clock;
    },
  };
}

const actor = (userId: string, memberships: Actor["memberships"], platformRole: Actor["platformRole"] = null): Actor => ({ userId, email: `${userId}@test`, memberships, platformRole });

export const ACTORS = {
  /** Administración de Clínica Arboleda. */
  laura: actor("laura", [{ organizationId: ORG.clinic, role: "admin" }]),
  /** Recepción en Arboleda y Administración en Nutrición Vital. */
  mario: actor("mario", [
    { organizationId: ORG.clinic, role: "reception" },
    { organizationId: ORG.nutrition, role: "admin" },
  ]),
  /** Profesional en Arboleda. */
  ana: actor("ana", [{ organizationId: ORG.clinic, role: "professional" }]),
  /** Administración del consultorio independiente (Clínica B en las pruebas de aislamiento). */
  luis: actor("luis", [{ organizationId: ORG.independent, role: "admin" }]),
  /** Cuenta nueva con un espacio recién creado. */
  sofia: actor("sofia", [{ organizationId: NEW_ORG, role: "admin" }]),
  platform: actor("plataforma", [], "platform_admin"),
};

export const DETAILS = {
  legalName: "Clínica Nueva (demo)",
  establishmentType: "clinic",
  contactName: "Sofía Navarro",
  billingEmail: "sofia@nueva.test",
  phone: "55 0000 0000",
  country: "MX",
  timezone: "America/Mexico_City",
};

export const key = () => crypto.randomUUID();
