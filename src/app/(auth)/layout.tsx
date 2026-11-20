import { Wordmark } from "@/components/ui/layout";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Wordmark className="text-3xl" />
          <p className="mt-2 text-sm text-muted">Agenda para hospitales, clínicas y consultorios</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">{children}</div>
      </div>
    </main>
  );
}
