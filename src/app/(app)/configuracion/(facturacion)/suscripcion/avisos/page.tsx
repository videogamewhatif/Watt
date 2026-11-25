import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { NotificationInbox } from "@/features/billing/components/notification-inbox";
import { NOTIFICATION_TEMPLATES, type TemplateKey } from "@/features/billing/notifications";
import { formatDateTime, loadWorkspaceBilling } from "@/features/billing/workspace";

export const metadata: Metadata = { title: "Avisos de suscripción" };

export default async function NoticesPage() {
  const data = await loadWorkspaceBilling();
  if (!data) return null;
  const { ctx, actor, service, overview } = data;
  const tz = overview.account?.timezone ?? ctx.workspace.timezone;
  const notifications = await service.listNotifications(actor, ctx.workspace.id);
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Bandeja de demostración">
        Estos son los correos que Wattalis enviaría a {overview.account?.billing_email ?? "tu correo de facturación"}. En esta etapa no se envía ningún correo real.
      </Alert>
      <NotificationInbox
        items={notifications.map((n) => ({
          id: n.id,
          label: NOTIFICATION_TEMPLATES[n.template as TemplateKey] ?? n.template,
          subject: n.subject,
          recipient: n.recipient,
          dateLabel: formatDateTime(n.created_at, tz),
          html: n.html,
          text: n.text,
        }))}
      />
    </div>
  );
}
