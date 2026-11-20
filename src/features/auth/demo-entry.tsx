import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enterDemo } from "@/lib/demo/actions";

/** Botón «Pruebas»: recorre toda la interfaz con datos ficticios, sin cuenta. */
export function DemoEntry({ configured }: { configured: boolean }) {
  return (
    <div className="mt-6 space-y-3 border-t border-line pt-6">
      {!configured ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Aún no hay un proyecto de Supabase conectado, así que el inicio de sesión real no funciona todavía.
        </p>
      ) : null}
      <p className="text-sm text-muted">¿Solo quieres ver la interfaz? Entra con datos ficticios; no necesitas cuenta.</p>
      <form action={enterDemo.bind(null, "admin")}>
        <Button type="submit" variant="secondary" className="w-full" icon={<FlaskConical className="size-4" aria-hidden />}>
          Pruebas
        </Button>
      </form>
    </div>
  );
}
