import { Activity, Ban, CalendarCheck, ChartColumn, HandCoins, Receipt, Stethoscope, UsersRound, Wallet } from "lucide-react";
import type { ReportIcon as IconKey } from "../catalog";

const ICONS: Record<IconKey, typeof Activity> = {
  sales: ChartColumn,
  concepts: Receipt,
  closings: Wallet,
  audit: Ban,
  appointments: CalendarCheck,
  professionals: Stethoscope,
  patients: UsersRound,
  receivables: HandCoins,
  activity: Activity,
};

export function ReportIcon({ icon, className = "size-5" }: { icon: IconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden />;
}
