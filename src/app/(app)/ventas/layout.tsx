import { Building2 } from "lucide-react";
import { SubNav } from "@/components/shell/nav";
import { getPracticeContext } from "@/features/practice/queries";
import { SALES_NAV } from "@/lib/permissions";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const { areas } = await getPracticeContext();
  return (
    <>
      <SubNav label="Ventas" items={SALES_NAV} />
      {/* Ventas no cambia con el área elegida; se aclara solo si hay varias áreas. */}
      {areas.length > 1 ? (
        <p className="mx-auto mb-3 flex max-w-5xl items-center gap-1.5 text-xs text-muted print:hidden">
          <Building2 className="size-3.5 shrink-0" aria-hidden />
          Ventas de toda la clínica: incluye todas las áreas.
        </p>
      ) : null}
      {children}
    </>
  );
}
