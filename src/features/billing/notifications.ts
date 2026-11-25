// Plantillas de avisos de suscripción y su envío. En esta etapa NO se envían
// correos: el remitente de demostración guarda cada aviso en una bandeja visible
// en la aplicación. SesEmailSender queda preparado para Amazon SES y se activará
// cuando existan credenciales y un dominio verificado.

export const NOTIFICATION_TEMPLATES = {
  welcome: "Bienvenida a Wattalis",
  subscription_activated: "Suscripción activada",
  renewal_upcoming: "Renovación próxima",
  payment_succeeded: "Pago realizado",
  payment_failed: "Pago rechazado",
  payment_reminder: "Recordatorio de pago pendiente",
  plan_changed: "Cambio de plan",
  cancel_scheduled: "Cancelación programada",
  subscription_canceled: "Suscripción cancelada",
  subscription_reactivated: "Suscripción reactivada",
  trial_ending: "Fin del periodo de prueba",
} as const;

export type TemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

export type TemplateData = {
  organizationName: string;
  contactName: string;
  planName: string;
  /** Texto ya formateado: «$899.00 MXN». */
  amount?: string;
  /** Fecha ya formateada en la zona del espacio. */
  date?: string;
  intervalLabel?: string;
  fromPlanName?: string;
  reference?: string;
  appUrl: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

type Body = { subject: string; heading: string; paragraphs: string[]; cta?: { label: string; path: string } };

const BODIES: Record<TemplateKey, (d: TemplateData) => Body> = {
  welcome: (d) => ({
    subject: "¡Bienvenido a Wattalis!",
    heading: `¡Bienvenido a Wattalis, ${d.contactName}!`,
    paragraphs: [`El espacio de trabajo de ${d.organizationName} está listo. Ya puedes registrar profesionales, servicios y tu primera cita.`],
    cta: { label: "Ir a mi espacio de trabajo", path: "/inicio" },
  }),
  subscription_activated: (d) => ({
    subject: `Tu plan ${d.planName} está activo`,
    heading: "Suscripción activada",
    paragraphs: [
      `La suscripción de ${d.organizationName} al plan ${d.planName}${d.intervalLabel ? ` (${d.intervalLabel.toLowerCase()})` : ""} está activa.`,
      d.date ? `La próxima renovación está prevista para el ${d.date}.` : "",
    ],
    cta: { label: "Ver mi suscripción", path: "/configuracion/suscripcion" },
  }),
  renewal_upcoming: (d) => ({
    subject: `Tu plan ${d.planName} se renueva pronto`,
    heading: "Renovación próxima",
    paragraphs: [`El plan ${d.planName} de ${d.organizationName} se renovará el ${d.date ?? "próximo periodo"}${d.amount ? ` por ${d.amount}` : ""}.`, "Si quieres cambiar de plan o cancelar la renovación, puedes hacerlo antes de esa fecha."],
    cta: { label: "Revisar renovación", path: "/configuracion/suscripcion/renovacion" },
  }),
  payment_succeeded: (d) => ({
    subject: "Recibimos tu pago",
    heading: "Pago realizado",
    paragraphs: [`Registramos el pago de ${d.amount ?? "tu suscripción"} del plan ${d.planName}.`, d.reference ? `Referencia de operación: ${d.reference}.` : ""],
    cta: { label: "Ver historial de pagos", path: "/configuracion/facturacion" },
  }),
  payment_failed: (d) => ({
    subject: "No pudimos procesar tu pago",
    heading: "Pago rechazado",
    paragraphs: [
      `El cobro de ${d.amount ?? "tu suscripción"} del plan ${d.planName} fue rechazado.`,
      "Conservas el acceso mientras reintentamos. Actualiza tu método de pago para evitar interrupciones. Tu información no se modifica.",
    ],
    cta: { label: "Actualizar método de pago", path: "/configuracion/suscripcion/metodos-de-pago" },
  }),
  payment_reminder: (d) => ({
    subject: "Tienes un pago pendiente",
    heading: "Recordatorio de pago pendiente",
    paragraphs: [
      `El pago del plan ${d.planName} de ${d.organizationName} sigue pendiente.`,
      d.date ? `El periodo de gracia termina el ${d.date}. Después, el espacio pasará a modo de consulta sin perder información.` : "El espacio está en modo de consulta: puedes ver y exportar tu información.",
    ],
    cta: { label: "Regularizar pago", path: "/configuracion/suscripcion" },
  }),
  plan_changed: (d) => ({
    subject: `Cambio de plan: ${d.planName}`,
    heading: "Cambio de plan",
    paragraphs: [d.fromPlanName ? `${d.organizationName} cambia del plan ${d.fromPlanName} al plan ${d.planName}.` : `${d.organizationName} cambia al plan ${d.planName}.`, d.date ? `El cambio entra en vigor el ${d.date}.` : ""],
    cta: { label: "Ver mi plan", path: "/configuracion/suscripcion" },
  }),
  cancel_scheduled: (d) => ({
    subject: "Cancelación programada",
    heading: "Programaste la cancelación",
    paragraphs: [
      `El plan ${d.planName} de ${d.organizationName} no se renovará. Conservas el acceso hasta el ${d.date ?? "final del periodo"}.`,
      "Tu información no se borra. Puedes deshacer la cancelación en cualquier momento antes de esa fecha.",
    ],
    cta: { label: "Deshacer cancelación", path: "/configuracion/suscripcion" },
  }),
  subscription_canceled: (d) => ({
    subject: "Tu suscripción terminó",
    heading: "Suscripción cancelada",
    paragraphs: [`La suscripción de ${d.organizationName} terminó. Tu información se conserva en modo de consulta.`, "Puedes reactivar un plan cuando quieras desde la configuración del espacio."],
    cta: { label: "Reactivar suscripción", path: "/configuracion/suscripcion" },
  }),
  subscription_reactivated: (d) => ({
    subject: "Tu suscripción está activa de nuevo",
    heading: "Suscripción reactivada",
    paragraphs: [`Reactivamos el plan ${d.planName} de ${d.organizationName}.`, d.date ? `La próxima renovación es el ${d.date}.` : ""],
    cta: { label: "Ir a mi espacio de trabajo", path: "/inicio" },
  }),
  trial_ending: (d) => ({
    subject: "Tu periodo de prueba está por terminar",
    heading: "Fin del periodo de prueba",
    paragraphs: [
      `El periodo de prueba del plan ${d.planName} de ${d.organizationName} termina el ${d.date ?? "pronto"}.`,
      "Al terminar se cobrará el plan con tu método de pago. Si prefieres otro plan, puedes cambiarlo antes.",
    ],
    cta: { label: "Revisar mi plan", path: "/configuracion/suscripcion" },
  }),
};

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Genera asunto, texto y HTML (estilos en línea, compatible con clientes de correo). */
export function renderEmail(key: TemplateKey, data: TemplateData, { demo = true }: { demo?: boolean } = {}): RenderedEmail {
  const body = BODIES[key](data);
  const paragraphs = body.paragraphs.filter(Boolean);
  const ctaUrl = body.cta ? `${data.appUrl.replace(/\/$/, "")}${body.cta.path}` : null;
  const demoNote = "Correo de demostración generado por Wattalis. No se envió ni corresponde a un cobro real.";
  const text = [body.heading, "", ...paragraphs, ...(ctaUrl ? ["", `${body.cta!.label}: ${ctaUrl}`] : []), "", "— Equipo Wattalis", ...(demo ? ["", demoNote] : [])].join("\n");
  const html = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>${escape(body.subject)}</title></head>
<body style="margin:0;background:#f6f5f1;font-family:Figtree,Segoe UI,Helvetica,Arial,sans-serif;color:#1b2528">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2dfd7;border-radius:16px">
${demo ? `<tr><td style="background:#fffbeb;border-bottom:1px solid #fcd34d;border-radius:16px 16px 0 0;padding:10px 24px;font-size:12px;color:#78350f">${escape(demoNote)}</td></tr>` : ""}
<tr><td style="padding:24px 24px 8px;font-size:20px;font-weight:700;color:#15454a">Wattalis<span style="color:#f59e0b">.</span></td></tr>
<tr><td style="padding:8px 24px 0"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escape(body.heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3d4a4e">${escape(p)}</p>`).join("\n")}
</td></tr>
${ctaUrl ? `<tr><td style="padding:8px 24px 24px"><a href="${escape(ctaUrl)}" style="display:inline-block;background:#175359;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${escape(body.cta!.label)}</a></td></tr>` : ""}
<tr><td style="border-top:1px solid #e2dfd7;padding:16px 24px;font-size:12px;color:#5f6b6e">Recibes este aviso porque administras la suscripción de ${escape(data.organizationName)} en Wattalis.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: body.subject, text, html };
}

export type OutgoingEmail = RenderedEmail & { to: string; template: TemplateKey; organizationId: string | null; billingAccountId: string | null };

/** Destino de los avisos. La implementación activa decide si se envían o solo se guardan. */
export interface NotificationSender {
  readonly name: string;
  /** false: no sale ningún correo (bandeja de demostración). */
  readonly delivers: boolean;
  send(email: OutgoingEmail): Promise<{ status: "demo_not_sent" | "queued" | "sent"; messageId: string | null }>;
}

/** Guarda el aviso en la bandeja (lo persiste el repositorio). Nunca envía correos. */
export class DemoInboxSender implements NotificationSender {
  readonly name = "demo-inbox";
  readonly delivers = false;
  async send() {
    return { status: "demo_not_sent" as const, messageId: null };
  }
}

/**
 * Preparado para Amazon SES (SESv2 SendEmail). Deshabilitado: requiere
 * AWS_REGION, WATTALIS_SES_FROM (remitente verificado) y credenciales del rol de
 * ejecución (nunca en el navegador). En producción conviene encolar en SQS y
 * enviar desde una Lambda para reintentos y control de rebotes.
 */
export class SesEmailSender implements NotificationSender {
  readonly name = "amazon-ses";
  readonly delivers = true;
  constructor(private readonly config: { region?: string; from?: string } = {}) {}
  async send(): Promise<never> {
    throw new Error(
      `Amazon SES no está habilitado${this.config.region ? "" : " (falta AWS_REGION)"}${this.config.from ? "" : " (falta WATTALIS_SES_FROM)"}. Los avisos se muestran en la bandeja de demostración.`,
    );
  }
}
