import { Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { agendaHref } from "@/features/agenda/params";
import { EditContactButton } from "@/features/patients/components";
import { PRACTICE_AREAS } from "@/lib/practice";
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

  const [{ data: appointments }, { data: types }] = await Promise.all([
    ctx.supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, service:services(name), professional:professionals(display_name, color, professional_type)")
      .eq("contact_id", id)
      .order("starts_at", { ascending: false })
      .limit(100),
    ctx.supabase.from("professional_types").select("code, label"),
  ]);
  // Área de atención de cada cita, según el tipo del profesional que la atendió.
  const areaOf = (type: string | undefined) => {
    const known = PRACTICE_AREAS.find((a) => a.key === type);
    if (known) return { label: known.label, color: known.color as string | null };
    const label = types?.find((t) => t.code === type)?.label;
    return label ? { label, color: null } : null;
  };

  const tz = ctx.workspace.timezone;
  const today = todayIn(tz);
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
        </ul>
      </Card>

      <Card>
        <CardHeader title="Citas" description={ctx.can.allAppointments ? undefined : "Solo se muestran tus citas con este paciente."} />
        {appointments && appointments.length > 0 ? (
          <ul className="divide-y divide-line">
            <li aria-hidden className="hidden gap-3 bg-sunken px-5 py-2 text-[11px] font-semibold tracking-wider text-muted uppercase sm:flex">
              <span className="w-36">Fecha</span>
              <span className="flex-1">Servicio</span>
              <span className="w-28">Área</span>
              <span className="w-24 text-right">Estado</span>
            </li>
            {appointments.map((a) => {
              const s = localParts(a.starts_at, tz);
              const e = localParts(a.ends_at, tz);
              const area = areaOf(a.professional?.professional_type);
              return (
                <li key={a.id}>
                  <Link href={agendaHref({ date: s.date, appointmentId: a.id })} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-sunken">
                    <span className="tabular w-36 font-medium">
                      {formatShortDate(s.date)}, {s.time}–{e.time}
                    </span>
                    <span className="min-w-0 flex-1">
                      {a.service?.name}
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: a.professional?.color }} />
                        {a.professional?.display_name}
                      </span>
                    </span>
                    <span className="flex w-28 items-center gap-1.5 text-xs font-medium text-ink-soft">
                      {area ? (
                        <>
                          <span
                            aria-hidden
                            className={`size-2 shrink-0 rounded-full ${area.color ? "" : "bg-stone-400"}`}
                            style={area.color ? { background: area.color } : undefined}
                          />
                          <span className="sr-only">Área: </span>
                          {area.label}
                        </>
                      ) : null}
                    </span>
                    <span className="flex w-24 justify-end">
                      <StatusBadge status={a.status} />
                    </span>
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
