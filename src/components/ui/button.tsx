import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  ghost: "text-ink-soft hover:bg-sunken hover:text-ink",
  danger: "bg-red-700 text-white hover:bg-red-800 shadow-sm",
  subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size; pending?: boolean; icon?: ReactNode };

export function Button({ variant = "primary", size = "md", pending, icon, className = "", children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending ? <Spinner /> : icon}
      {children}
    </button>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode };

export function LinkButton({ variant = "primary", size = "md", icon, className = "", children, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
      {label ? <span className="text-sm">{label}</span> : null}
    </span>
  );
}
