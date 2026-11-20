import { Ban, CheckCheck, CircleCheck, CircleDashed, UserX } from "lucide-react";
import type { AppointmentStatus } from "@/lib/database.types";
import { STATUS_LABEL } from "@/lib/labels";

export const STATUS_STYLE: Record<AppointmentStatus, { badge: string; card: string; Icon: typeof CircleDashed }> = {
  pending: { badge: "bg-amber-50 text-amber-900 ring-amber-300", card: "border-l-amber-500", Icon: CircleDashed },
  confirmed: { badge: "bg-sky-50 text-sky-900 ring-sky-300", card: "border-l-sky-600", Icon: CircleCheck },
  attended: { badge: "bg-emerald-50 text-emerald-900 ring-emerald-300", card: "border-l-emerald-600", Icon: CheckCheck },
  cancelled: { badge: "bg-stone-100 text-stone-700 ring-stone-300", card: "border-l-stone-400", Icon: Ban },
  no_show: { badge: "bg-rose-50 text-rose-900 ring-rose-300", card: "border-l-rose-600", Icon: UserX },
};

/** Estado con texto e ícono, además de color. */
export function StatusBadge({ status, size = "md" }: { status: AppointmentStatus; size?: "sm" | "md" }) {
  const { badge, Icon } = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset ${badge} ${
        size === "sm" ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-xs"
      }`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
