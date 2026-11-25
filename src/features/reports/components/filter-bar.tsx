import Form from "next/form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { PracticeArea } from "@/lib/practice";
import { PRESETS, presetHref, type ReportFilters } from "../params";

type ProfessionalOption = { id: string; name: string; type: string; active: boolean };

/**
 * Filtros en una sola fila sobre el reporte: periodos preestablecidos primero y
 * luego un rango propio, área y profesional. Todo vive en la URL, así que un
 * reporte se puede guardar en favoritos o compartir con el mismo filtro.
 */
export function FilterBar({
  reportKey,
  filters,
  areas,
  professionals,
  showArea,
  showProfessional,
}: {
  reportKey: string;
  filters: ReportFilters;
  areas: PracticeArea[];
  professionals: ProfessionalOption[];
  showArea: boolean;
  showProfessional: boolean;
}) {
  const options = filters.area ? professionals.filter((p) => p.type === filters.area) : professionals;
  return (
    <section aria-label="Filtros del reporte" className="space-y-3 rounded-2xl border border-line bg-surface p-4 print:hidden">
      <nav aria-label="Periodos">
        <ul className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const active = filters.preset === p.key;
            return (
              <li key={p.key}>
                <Link
                  href={presetHref(reportKey, p.key, filters)}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex h-8 items-center rounded-full px-3 text-sm font-medium transition-colors ${
                    active ? "bg-brand-700 text-white" : "bg-sunken text-ink-soft hover:bg-brand-50 hover:text-ink"
                  }`}
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* La clave reinicia los campos cuando cambian los filtros desde un enlace. */}
      <div key={`${filters.from}|${filters.to}|${filters.area ?? ""}|${filters.professionalId ?? ""}`} className="border-t border-line pt-3">
        <Form action={`/reportes/${reportKey}`} className="flex flex-wrap items-end gap-3">
          <Field label="Desde" className="w-40">
            {({ id }) => <Input id={id} type="date" name="desde" defaultValue={filters.from} required />}
          </Field>
          <Field label="Hasta" className="w-40">
            {({ id }) => <Input id={id} type="date" name="hasta" defaultValue={filters.to} required />}
          </Field>
          {showArea ? (
            <Field label="Área" className="w-44">
              {({ id }) => (
                <Select id={id} name="area" defaultValue={filters.area ?? ""}>
                  <option value="">Todas las áreas</option>
                  {areas.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {showProfessional ? (
            <Field label="Profesional" className="w-56">
              {({ id }) => (
                <Select id={id} name="profesional" defaultValue={filters.professionalId ?? ""}>
                  <option value="">Todos los profesionales</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.active ? p.name : `${p.name} (inactivo)`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Button type="submit" variant="secondary">
            Aplicar
          </Button>
        </Form>
      </div>
    </section>
  );
}
