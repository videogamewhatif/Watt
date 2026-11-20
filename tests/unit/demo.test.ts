// Modo de prueba: datos ficticios en memoria con los mismos permisos y reglas de agenda.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoClient } from "@/lib/demo/client";
import { getDemoStore, resetDemoStore } from "@/lib/demo/data";
import { DEMO_PERSONAS } from "@/lib/demo/personas";

const [admin, reception, professional, independent] = DEMO_PERSONAS.map((p) => createDemoClient(p.id));
const CLINIC = "b0000000-0000-4000-8000-000000000001";
const INDEP = "b0000000-0000-4000-8000-000000000002";
const RUIZ = "c0000000-0000-4000-8000-000000000001";
const SALAS = "c0000000-0000-4000-8000-000000000002";
const CONSULTA = "d0000000-0000-4000-8000-000000000001";

beforeEach(() => resetDemoStore());

async function nextSlot(client = reception) {
  const { data } = await client.rpc("get_available_slots", { p_professional_id: RUIZ, p_service_id: CONSULTA, p_from: new Date().toISOString().slice(0, 10), p_days: 14 });
  return data![0];
}

describe("modo de prueba", () => {
  it("aísla los espacios y limita al rol Profesional a lo suyo", async () => {
    const { data: indepOrgs } = await independent.from("organizations").select("name");
    expect(indepOrgs!.map((o) => o.name)).toEqual(["Consultorio Dr. Herrera (demo)"]);
    const { data: leaked } = await admin.from("contacts").select("id").eq("organization_id", INDEP);
    expect(leaked).toEqual([]);
    const { data: own } = await professional.from("professionals").select("id");
    expect(own!.map((p) => p.id)).toEqual([RUIZ]);
    const { data: workspaces } = await reception.from("memberships").select("role, organization:organizations(name)").eq("user_id", DEMO_PERSONAS[1].id);
    expect(workspaces).toHaveLength(2);
    const { error } = await reception.from("professionals").insert({ organization_id: CLINIC, display_name: "Intento" }).select("id");
    expect(error?.code).toBe("42501");
  });

  it("agenda, rechaza el mismo horario y conserva el original al reprogramar a un horario ocupado", async () => {
    const slot = await nextSlot();
    const book = (key: string | null) =>
      reception.rpc("book_appointment", {
        p_professional_id: RUIZ,
        p_service_id: CONSULTA,
        p_contact_id: "e0000000-0000-4000-8000-000000000001",
        p_local_date: slot.local_start.slice(0, 10),
        p_local_time: slot.local_start.slice(11),
        p_idempotency_key: key,
      });
    const first = await book("6f9d7a52-2a33-4c4e-9f53-0c4b1d1e6a11");
    expect(first.error).toBeNull();
    const retry = await book("6f9d7a52-2a33-4c4e-9f53-0c4b1d1e6a11");
    expect((retry.data as { id: string }).id).toBe((first.data as { id: string }).id);
    const clash = await book(null);
    expect(clash.error?.message).toBe("slot_taken");

    const other = await nextSlot();
    const second = await reception.rpc("book_appointment", {
      p_professional_id: RUIZ,
      p_service_id: CONSULTA,
      p_contact_id: "e0000000-0000-4000-8000-000000000004",
      p_local_date: other.local_start.slice(0, 10),
      p_local_time: other.local_start.slice(11),
    });
    const id = (second.data as { id: string }).id;
    const before = getDemoStore().appointments.find((a) => a.id === id)!.starts_at;
    const moved = await reception.rpc("reschedule_appointment", {
      p_appointment_id: id,
      p_local_date: slot.local_start.slice(0, 10),
      p_local_time: slot.local_start.slice(11),
    });
    expect(moved.error?.message).toBe("slot_taken");
    expect(getDemoStore().appointments.find((a) => a.id === id)!.starts_at).toBe(before);
  });

  it("el rol Profesional no agenda en la agenda de otro profesional", async () => {
    const { error } = await professional.rpc("get_available_slots", { p_professional_id: SALAS, p_service_id: CONSULTA, p_from: "2026-11-20" });
    expect(error?.message).toBe("forbidden");
  });
});
