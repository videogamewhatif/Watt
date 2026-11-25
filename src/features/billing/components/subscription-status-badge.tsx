import { CircleAlert, CircleCheck, CircleDashed, CircleSlash, Clock, Hourglass, PauseCircle, Sparkles } from "lucide-react";
import { STATUS_INFO } from "../state-machine";
import type { SubscriptionStatus } from "../types";

const STYLE: Record<SubscriptionStatus, { badge: string; Icon: typeof CircleCheck }> = {
  active: { badge: "bg-emerald-50 text-emerald-900 ring-emerald-300", Icon: CircleCheck },
  trialing: { badge: "bg-sky-50 text-sky-900 ring-sky-300", Icon: Sparkles },
  past_due: { badge: "bg-amber-50 text-amber-950 ring-amber-300", Icon: CircleAlert },
  grace_period: { badge: "bg-amber-50 text-amber-950 ring-amber-400", Icon: Hourglass },
  unpaid: { badge: "bg-red-50 text-red-900 ring-red-300", Icon: PauseCircle },
  canceled: { badge: "bg-stone-100 text-stone-700 ring-stone-300", Icon: CircleSlash },
  expired: { badge: "bg-stone-100 text-stone-700 ring-stone-300", Icon: Clock },
  incomplete: { badge: "bg-amber-50 text-amber-950 ring-amber-300", Icon: CircleDashed },
};

/** Estado de la suscripción con texto e ícono (nunca solo color). */
export function SubscriptionStatusBadge({ status, cancelAtPeriodEnd = false, size = "md" }: { status: SubscriptionStatus | "none"; cancelAtPeriodEnd?: boolean; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-xs";
  if (status === "none") {
    return <span className={`inline-flex items-center gap-1 rounded-full bg-stone-100 font-medium text-stone-700 ring-1 ring-stone-300 ring-inset ${sizing}`}>Sin plan</span>;
  }
  const { badge, Icon } = STYLE[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset ${badge} ${sizing}`}>
        <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
        {STATUS_INFO[status].label}
      </span>
      {cancelAtPeriodEnd && !["canceled", "expired"].includes(status) ? (
        <span className={`inline-flex items-center gap-1 rounded-full bg-stone-100 font-medium text-stone-700 ring-1 ring-stone-300 ring-inset ${sizing}`}>
          <CircleSlash className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
          No se renovará
        </span>
      ) : null}
    </span>
  );
}
