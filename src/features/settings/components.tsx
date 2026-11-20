"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { MemberRole, OrganizationKind } from "@/lib/database.types";
import { KIND_LABEL, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/labels";
import { MEXICO_TIMEZONES } from "@/lib/tz";
import { changeMemberRole, inviteMember, leaveWorkspace, removeMember, revokeInvitation, updateProfile, updateWorkspace } from "./actions";

export function WorkspaceForm({
  workspace,
}: {
  workspace: { id: string; name: string; kind: OrganizationKind; timezone: string; slotInterval: number };
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [values, setValues] = useState({ name: workspace.name, kind: workspace.kind, timezone: workspace.timezone, slotInterval: String(workspace.slotInterval) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const zones = MEXICO_TIMEZONES.some((z) => z.value === workspace.timezone) ? MEXICO_TIMEZONES : [{ value: workspace.timezone, label: workspace.timezone }, ...MEXICO_TIMEZONES];

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateWorkspace({ organizationId: workspace.id, ...values });
          if (result.ok) {
            setErrors({});
            setError(null);
            notify(result.message ?? "Guardado.");
            router.refresh();
          } else {
            setErrors(result.fieldErrors ?? {});
            setError(result.fieldErrors ? null : result.error);
          }
        });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre del espacio" required value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} error={errors.name} />
        <Field label="Tipo">
          {({ id }) => (
            <Select id={id} value={values.kind} onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value as OrganizationKind }))}>
              {(Object.keys(KIND_LABEL) as OrganizationKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Zona horaria" hint="Los horarios semanales son horas locales de esta zona. Las citas ya agendadas conservan su instante." error={errors.timezone}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={values.timezone} onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}>
              {zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Intervalo de la agenda" hint="Cada cuántos minutos se ofrecen horarios." error={errors.slotInterval}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={values.slotInterval} onChange={(e) => setValues((v) => ({ ...v, slotInterval: e.target.value }))}>
              {[5, 10, 15, 20, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} minutos
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Button type="submit" pending={pending}>
        Guardar cambios
      </Button>
    </form>
  );
}

export type MemberItem = { membershipId: string; userId: string; name: string; email: string | null; role: MemberRole; isSelf: boolean };

export function MembersList({ organizationId, members }: { organizationId: string; members: MemberItem[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MemberItem | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {members.map((m) => (
          <li key={m.membershipId} className="flex flex-wrap items-center gap-3 px-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {m.name}
                {m.isSelf ? <span className="font-normal text-muted"> (tú)</span> : null}
              </span>
              <span className="block truncate text-xs text-muted">{m.email}</span>
            </span>
            <label className="sr-only" htmlFor={`rol-${m.membershipId}`}>
              Rol de {m.name}
            </label>
            <select
              id={`rol-${m.membershipId}`}
              value={m.role}
              disabled={pending}
              onChange={(e) =>
                startTransition(async () => {
                  const result = await changeMemberRole(organizationId, m.membershipId, e.target.value as MemberRole);
                  if (result.ok) {
                    setError(null);
                    notify(result.message ?? "Guardado.");
                  } else setError(result.error);
                  router.refresh();
                })
              }
              className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"
            >
              {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            {!m.isSelf ? (
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setRemoving(m)}>
                Quitar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(removing)}
        title={`¿Quitar a ${removing?.name ?? ""} del espacio?`}
        confirmLabel="Quitar acceso"
        pending={pending}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          startTransition(async () => {
            if (!removing) return;
            const result = await removeMember(organizationId, removing.membershipId);
            setRemoving(null);
            if (result.ok) {
              setError(null);
              notify(result.message ?? "Listo.");
              router.refresh();
            } else setError(result.error);
          })
        }
      >
        <p>Perderá el acceso de inmediato. Su perfil profesional (si tiene) y sus citas se conservan; solo se desvincula la cuenta.</p>
      </ConfirmDialog>
    </div>
  );
}

export type InvitationItem = { id: string; email: string; role: MemberRole; status: "vigente" | "vencida" | "aceptada" | "revocada"; expiresLabel: string; professional: string | null };

export function Invitations({
  organizationId,
  invitations,
  professionals,
  preselectProfessionalId,
}: {
  organizationId: string;
  invitations: InvitationItem[];
  professionals: { id: string; display_name: string }[];
  preselectProfessionalId: string | null;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [form, setForm] = useState({
    email: "",
    role: (preselectProfessionalId ? "professional" : "reception") as MemberRole,
    professionalId: preselectProfessionalId ?? "",
    validDays: "7",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ link: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-5">
      <form
        noValidate
        className="space-y-4 rounded-xl border border-line bg-canvas p-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            setCopied(false);
            const result = await inviteMember({
              organizationId,
              email: form.email,
              role: form.role,
              professionalId: form.role !== "reception" && form.professionalId ? form.professionalId : null,
              validDays: form.validDays,
            });
            if (result.ok) {
              setCreated({ link: result.data.link, email: form.email.trim().toLowerCase() });
              setErrors({});
              setError(null);
              setForm((f) => ({ ...f, email: "", professionalId: "" }));
              router.refresh();
            } else {
              setErrors(result.fieldErrors ?? {});
              setError(result.fieldErrors ? null : result.error);
            }
          });
        }}
      >
        <p className="text-sm font-semibold">Invitar a una persona</p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Correo de la persona invitada" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={errors.email} hint="Solo podrá aceptarla con este correo, verificado." />
          <Field label="Rol" hint={ROLE_DESCRIPTION[form.role]}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as MemberRole }))}>
                {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {form.role !== "reception" && professionals.length > 0 ? (
            <Field label="Vincular con el perfil profesional" hint="Opcional. Al aceptar, verá la agenda de este perfil.">
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={form.professionalId} onChange={(e) => setForm((f) => ({ ...f, professionalId: e.target.value }))}>
                  <option value="">Sin vincular</option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Vigencia">
            {({ id }) => (
              <Select id={id} value={form.validDays} onChange={(e) => setForm((f) => ({ ...f, validDays: e.target.value }))}>
                <option value="1">1 día</option>
                <option value="3">3 días</option>
                <option value="7">7 días</option>
                <option value="14">14 días</option>
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit" pending={pending} icon={<Link2 className="size-4" aria-hidden />}>
          Crear enlace de invitación
        </Button>
      </form>

      {created ? (
        <Alert tone="success" title={`Enlace para ${created.email}`}>
          <p>Cópialo y compártelo por el medio que prefieras. Es de un solo uso y solo se muestra ahora.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="max-w-full rounded bg-surface px-2 py-1 text-xs break-all">{created.link}</code>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.link);
                  setCopied(true);
                  notify("Enlace copiado.");
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copiado" : "Copiar enlace"}
            </Button>
          </div>
        </Alert>
      ) : null}

      {invitations.length > 0 ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {invitations.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-all">{inv.email}</span>
                <span className="block text-xs text-muted">
                  {ROLE_LABEL[inv.role]}
                  {inv.professional ? ` · ${inv.professional}` : ""} · {inv.expiresLabel}
                </span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  inv.status === "vigente"
                    ? "bg-sky-50 text-sky-900 ring-sky-300"
                    : inv.status === "aceptada"
                      ? "bg-emerald-50 text-emerald-900 ring-emerald-300"
                      : "bg-stone-100 text-stone-700 ring-stone-300"
                }`}
              >
                {inv.status[0].toUpperCase() + inv.status.slice(1)}
              </span>
              {inv.status === "vigente" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await revokeInvitation(organizationId, inv.id);
                      if (result.ok) notify(result.message ?? "Listo.");
                      else setError(result.error);
                      router.refresh();
                    })
                  }
                >
                  Revocar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState(fullName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateProfile(name);
          if (result.ok) {
            setError(null);
            notify(result.message ?? "Guardado.");
            router.refresh();
          } else setError(result.error);
        });
      }}
    >
      <TextField label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} error={error} className="min-w-64 flex-1" hint={`Correo de acceso: ${email}`} />
      <Button type="submit" variant="secondary" pending={pending}>
        Guardar nombre
      </Button>
    </form>
  );
}

export function LeaveWorkspace({ organizationId, name }: { organizationId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button variant="ghost" className="text-red-700" onClick={() => setOpen(true)}>
        Salir de este espacio
      </Button>
      <ConfirmDialog
        open={open}
        title={`¿Salir de ${name}?`}
        confirmLabel="Salir del espacio"
        pending={pending}
        onClose={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await leaveWorkspace(organizationId);
            setOpen(false);
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        <p>Perderás el acceso a este espacio. Para volver necesitarás una nueva invitación.</p>
      </ConfirmDialog>
    </>
  );
}
