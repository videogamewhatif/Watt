import { type ComponentProps, type ReactNode, useId } from "react";

const control =
  "block w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted/80 disabled:bg-sunken disabled:text-muted";
const controlOk = "border-line-strong";
const controlError = "border-red-600 ring-1 ring-red-600";

type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/** Etiqueta visible, ayuda y mensaje de validación junto al campo. */
export function Field({ label, hint, error, required, className = "", children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-red-700"> *</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = ComponentProps<"input"> & { invalid?: boolean };

export function Input({ invalid, className = "", ...rest }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={`${control} h-10 ${invalid ? controlError : controlOk} ${className}`} {...rest} />;
}

type SelectProps = ComponentProps<"select"> & { invalid?: boolean };

export function Select({ invalid, className = "", children, ...rest }: SelectProps) {
  return (
    <select aria-invalid={invalid || undefined} className={`${control} h-10 pr-8 ${invalid ? controlError : controlOk} ${className}`} {...rest}>
      {children}
    </select>
  );
}

type TextareaProps = ComponentProps<"textarea"> & { invalid?: boolean };

export function Textarea({ invalid, className = "", ...rest }: TextareaProps) {
  return <textarea aria-invalid={invalid || undefined} className={`${control} py-2 ${invalid ? controlError : controlOk} ${className}`} {...rest} />;
}

/** Campo de texto completo con etiqueta, ayuda y error. */
export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...input
}: Omit<InputProps, "children"> & { label: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} required={required} {...input} />}
    </Field>
  );
}

export function Checkbox({ label, description, ...rest }: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" {...rest} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {description ? <span className="block text-muted">{description}</span> : null}
      </label>
    </div>
  );
}
