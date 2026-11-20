"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Textarea, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveService } from "./actions";

type Service = { id: string; name: string; duration_minutes: number; description: string | null; active: boolean; professional_ids: string[] };

export function ServiceDialog({
  organizationId,
  service,
  professionals,
}: {
  organizationId: string;
  service?: Service;
  professionals: { id: string; display_name: string; active: boolean }[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const blank = { name: "", duration: "30", description: "", active: true, professionalIds: professionals.length === 1 ? [professionals[0].id] : [] };
  const fromService = (s: Service) => ({ name: s.name, duration: String(s.duration_minutes), description: s.description ?? "", active: s.active, professionalIds: s.professional_ids });
  const [values, setValues] = useState(service ? fromService(service) : blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openDialog = () => {
    setValues(service ? fromService(service) : blank);
    setErrors({});
    setError(null);
    setOpen(true);
  };

  return (
    <>
      {service ? (
        <Button size="sm" variant="ghost" onClick={openDialog} icon={<Pencil className="size-4" aria-hidden />} aria-label={`Editar ${service.name}`}>
          Editar
        </Button>
      ) : (
        <Button onClick={openDialog} icon={<Plus className="size-4" aria-hidden />}>
          Nuevo servicio
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={service ? "Editar servicio" : "Nuevo servicio"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              pending={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveService({
                    organizationId,
                    id: service?.id ?? null,
                    name: values.name,
                    durationMinutes: values.duration,
                    description: values.description,
                    active: values.active,
                    professionalIds: values.professionalIds,
                  });
                  if (result.ok) {
                    setOpen(false);
                    notify(result.message ?? "Guardado.");
                    router.refresh();
                  } else {
                    setErrors(result.fieldErrors ?? {});
                    setError(result.fieldErrors ? null : result.error);
                  }
                })
              }
            >
              Guardar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <TextField label="Nombre" required value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} error={errors.name} />
          <TextField
            label="Duración (minutos)"
            required
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            step={5}
            value={values.duration}
            onChange={(e) => setValues((v) => ({ ...v, duration: e.target.value }))}
            error={errors.durationMinutes}
            hint={service ? "Si cambias la duración, las citas ya registradas conservan su hora final." : undefined}
            className="max-w-48"
          />
          <Field label="Descripción" hint="Opcional." error={errors.description}>
            {({ id, describedBy, invalid }) => (
              <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={2} maxLength={500} value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />
            )}
          </Field>
          <Checkbox label="Servicio activo" description="Los servicios inactivos no se ofrecen en nuevas citas." checked={values.active} onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))} />
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Profesionales que lo ofrecen</legend>
            {professionals.length === 0 ? (
              <p className="text-sm text-muted">Aún no hay profesionales. Podrás asignarlo después.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {professionals.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={`${p.display_name}${p.active ? "" : " (inactivo)"}`}
                    checked={values.professionalIds.includes(p.id)}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        professionalIds: e.target.checked ? [...v.professionalIds, p.id] : v.professionalIds.filter((x) => x !== p.id),
                      }))
                    }
                  />
                ))}
              </div>
            )}
          </fieldset>
        </div>
      </Dialog>
    </>
  );
}
