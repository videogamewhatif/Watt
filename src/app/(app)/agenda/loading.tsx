import { Spinner } from "@/components/ui/button";

export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-muted">
      <Spinner label="Cargando agenda…" />
    </div>
  );
}
