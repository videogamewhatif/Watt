"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert tone="error" title="Algo salió mal al cargar esta página" action={<Button variant="secondary" onClick={() => reset()}>Reintentar</Button>}>
        Tus datos están a salvo. Revisa tu conexión e inténtalo de nuevo.
      </Alert>
    </div>
  );
}
