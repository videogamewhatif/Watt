import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "error";

const tones: Record<Tone, { box: string; Icon: typeof Info }> = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-950", Icon: Info },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-950", Icon: CircleCheck },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-950", Icon: TriangleAlert },
  error: { box: "border-red-200 bg-red-50 text-red-950", Icon: CircleAlert },
};

export function Alert({ tone = "info", title, children, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const { box, Icon } = tones[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${box}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
