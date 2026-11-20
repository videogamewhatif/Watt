"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/features/workspaces/actions";

export function AcceptInvitationButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        pending={pending}
        className="w-full"
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInvitation(token);
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        Aceptar invitación
      </Button>
    </div>
  );
}
