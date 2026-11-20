import { Mail, PawPrint, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { agendaHref } from "@/features/agenda/params";
import { EditContactButton } from "@/features/patients/components";
import { getAppContext } from "@/lib/session";
import { formatShortDate, localParts, todayIn } from "@/lib/tz";

export const metadata: Metadata = { title: "Paciente" };

export default async function PatientPage({ params }: PageProps<"/pacientes/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getAppContext();
  const { data: contact } = await ctx.supabase
    .from("contacts")
    .select("id, full_name, phone, email, created_by")
    .eq("id", id)
    .eq("organization_id", ctx.workspace.id)
    .maybeSingle();
  // Fuera de los permisos de la cuenta, el contacto no existe.
  if (!contact) notFound();

  const { data: appointments } = await ctx.supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, pet_name, service:services(name), professional:professionals(display_name, color)")
    .eq("contact_id", id)
    .order("starts_at", { ascending: false })
    .limit(100);

  const tz = ctx.workspace.timezone;
  const today = todayIn(tz);
  const pets = [...new Set((appointments ?? []).map((a) => a.pet_name).filter(Boolean))];
  const canEdit = ctx.can.allAppointments || contact.created_by === ctx.user.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/pacientes" className="text-sm font-medium text-brand-700 hover:underline">
        ← {ctx.can.allAppointments ? "Pacientes" : "Mis pacientes"}
      </Link>
      <Card>
        <CardHeader
          title={<span className="text-xl">{contact.full_name}</span>}
          actions={
            <>
              {canEdit ? <EditContactButton organizationId={ctx.workspace.id} contact={contact} /> : null}
              <LinkButton size="sm" href={agendaHref({ date: today, openNew: true })}>
                Agendar cita
              </LinkButton>
            </>
          }
        />
        <ul className="space-y-2 px-5 py-4 text-sm">
          {contact.phone ? (
            <li className="flex items-center gap-2">
              <Phone className="size-4 text-muted" aria-hidden />
              <a className="text-brand-800 hover:underline" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
                {contact.phone}
              </a>
            </li>
          ) : null}
          {contact.email ? (
            <li className="flex items-center gap-2">
              <Mail className="size-4 text-muted" aria-hidden />
              <span className="break-all">{contact.email}</span>
            </li>
          ) : null}
          {pets.length ? (
            <li className="flex items-center gap-2">
              <PawPrint className="size-4 text-muted" aria-hidden />
              Mascotas en sus citas: {pets.join(", ")}
            </li>
          ) : null}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Citas" description={ctx.can.allAppointments ? undefined : "Solo se muestran tus citas con este paciente."} />
        {appointments && appointments.length > 0 ? (
          <ul className="divide-y divide-line">
            {appointments.map((a) => {
              const s = localParts(a.starts_at, tz);
              const e = localParts(a.ends_at, tz);
              return (
                <li key={a.id}>
                  <Link href={agendaHref({ date: s.date, appointmentId: a.id })} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-sunken">
                    <span className="tabular w-36 font-medium">
                      {formatShortDate(s.date)}, {s.time}–{e.time}
                    </span>
                    <span className="min-w-0 flex-1">
                      {a.service?.name}
                      {a.pet_name ? ` · ${a.pet_name}` : ""}
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: a.professional?.color }} />
                        {a.professional?.display_name}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">Sin citas registradas.</p>
        )}
      </Card>
    </div>
  );
}
