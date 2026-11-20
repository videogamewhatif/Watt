import Link from "next/link";
import { Wordmark } from "@/components/ui/layout";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Wordmark className="text-2xl" />
      <h1 className="text-xl font-semibold">No encontramos esta página</h1>
      <p className="max-w-md text-sm text-muted">Puede que no exista o que no tengas acceso desde el espacio de trabajo activo.</p>
      <Link href="/inicio" className="font-medium text-brand-700 hover:underline">
        Ir a Inicio
      </Link>
    </main>
  );
}
