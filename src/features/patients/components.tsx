"use client";

import { Pencil, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { ContactSummary } from "./actions";
import { ContactEditor } from "./contact-editor";

export function NewContactButton({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<UserPlus className="size-4" aria-hidden />}>
        Nuevo paciente
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nuevo paciente o contacto" description="Solo datos administrativos: nombre y al menos un medio de contacto.">
        {open ? (
          <ContactEditor
            organizationId={organizationId}
            submitLabel="Registrar"
            onCancel={() => setOpen(false)}
            onSaved={(c) => {
              setOpen(false);
              notify("Contacto registrado.");
              router.push(`/pacientes/${c.id}`);
            }}
            onUseExisting={(c) => {
              setOpen(false);
              router.push(`/pacientes/${c.id}`);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

export function EditContactButton({ organizationId, contact }: { organizationId: string; contact: ContactSummary }) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} icon={<Pencil className="size-4" aria-hidden />}>
        Editar
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Editar contacto">
        {open ? (
          <ContactEditor
            organizationId={organizationId}
            contactId={contact.id}
            initial={contact}
            onCancel={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              notify("Contacto actualizado.");
              router.refresh();
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
