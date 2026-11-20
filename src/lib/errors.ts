// Traduce errores de PostgreSQL/Supabase a mensajes claros en español.
// Nunca incluye datos de pacientes ni detalles técnicos en lo que se registra.

type DbError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined;

const MESSAGES: Record<string, string> = {
  slot_taken: "Ese horario ya está ocupado para este profesional.",
  outside_schedule: "La cita no cabe completa dentro del horario de atención del profesional.",
  blocked: "El profesional tiene un bloqueo en ese horario.",
  appointment_in_past: "No se puede agendar en un horario que ya pasó.",
  professional_inactive: "El profesional está desactivado y no recibe nuevas citas.",
  professional_not_found: "No encontramos al profesional en este espacio.",
  service_inactive: "El servicio está desactivado.",
  service_not_found: "No encontramos el servicio en este espacio.",
  service_not_offered: "El profesional no ofrece ese servicio.",
  invalid_status_transition: "Esa acción no está disponible para el estado actual de la cita.",
  invalid_initial_status: "Una cita nueva solo puede quedar pendiente o confirmada.",
  appointment_not_started: "Solo puedes marcar como atendida o no asistió una cita que ya comenzó.",
  appointment_closed: "Solo se pueden reprogramar citas pendientes o confirmadas.",
  appointment_not_found: "No encontramos la cita o no tienes acceso a ella.",
  appointment_field_immutable: "Para cambiar paciente o servicio, cancela la cita y crea una nueva.",
  contact_not_accessible: "No tienes acceso a ese paciente. Regístralo o elige uno de tus pacientes.",
  time_off_conflict: "Hay citas vigentes en ese periodo. Reprográmalas o cancélalas antes de crear el bloqueo.",
  last_admin: "El espacio debe conservar al menos un administrador.",
  organization_immutable: "Un registro no puede moverse a otro espacio de trabajo.",
  membership_immutable: "La membresía no puede cambiar de cuenta ni de espacio.",
  invalid_timezone: "La zona horaria no es válida.",
  invalid_email: "El correo no es válido.",
  invalid_range: "El rango de fechas no es válido.",
  invalid_schedule: "El horario no es válido.",
  already_member: "Esa persona ya es miembro de este espacio.",
  invalid_professional_link: "Ese perfil profesional no está disponible para vincularse (ya tiene cuenta o el rol no corresponde).",
  invitation_invalid: "El enlace de invitación no es válido.",
  invitation_revoked: "Esta invitación fue revocada. Pide un enlace nuevo.",
  invitation_used: "Esta invitación ya se utilizó.",
  invitation_expired: "Esta invitación venció. Pide un enlace nuevo.",
  invitation_email_mismatch: "Esta invitación es para otro correo. Inicia sesión con el correo invitado.",
  email_not_verified: "Confirma tu correo antes de aceptar la invitación.",
  not_authenticated: "Tu sesión terminó. Vuelve a iniciar sesión.",
  forbidden: "No tienes permiso para realizar esta acción.",
  demo_unavailable: "No disponible en el modo de prueba.",
};

/** Errores de disponibilidad que permiten ofrecer horarios alternativos. */
export const SLOT_ERRORS = new Set(["slot_taken", "outside_schedule", "blocked", "appointment_in_past"]);

export function errorCode(error: DbError): string {
  if (!error) return "unknown";
  if (error.message && MESSAGES[error.message]) return error.message;
  switch (error.code) {
    case "23P01":
      return error.message?.includes("availability_rules") ? "schedule_overlap" : "slot_taken";
    case "42501":
      return "forbidden";
    case "23503":
      return "foreign_key";
    case "23505":
      return "duplicate";
    case "23514":
      return "check_violation";
    case "PGRST116":
      return "not_found";
    default:
      return "unknown";
  }
}

export function errorMessage(error: DbError, fallback = "No se pudo completar la operación. Intenta de nuevo."): string {
  const code = errorCode(error);
  if (MESSAGES[code]) return MESSAGES[code];
  switch (code) {
    case "schedule_overlap":
      return "Hay bloques de horario que se traslapan el mismo día.";
    case "foreign_key":
      return "La información relacionada no pertenece a este espacio o ya no existe.";
    case "duplicate":
      return "Ya existe un registro igual.";
    case "check_violation":
      return "Revisa los datos: alguno no cumple el formato requerido.";
    case "not_found":
      return "No encontramos el registro o no tienes acceso a él.";
    default:
      return fallback;
  }
}

/** Registro técnico sin datos personales: solo contexto y código. */
export function logError(context: string, error: DbError) {
  console.error(`[wattalis] ${context}: ${error?.code ?? "?"} ${errorCode(error)}`);
}
