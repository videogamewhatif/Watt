// Tipos de la base de datos con el formato de `supabase gen types typescript`.
// Si cambias las migraciones, regenéralos con:
//   npx supabase gen types typescript --local > src/lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string; updated_at: string };

export type MemberRole = "admin" | "reception" | "professional";
export type OrganizationKind = "hospital" | "clinic" | "independent";
export type AppointmentStatus = "pending" | "confirmed" | "attended" | "cancelled" | "no_show";
export type TimeOffKind = "vacation" | "meal" | "absence" | "other";
export type AppointmentEventType = "created" | "status_changed" | "rescheduled" | "details_updated";
export type PaymentMethod = "cash" | "card" | "transfer";
export type ChargeStatus = "paid" | "voided";
export type CashMovementKind = "in" | "out";

export type ProfileRow = Timestamps & { id: string; full_name: string; email: string | null };
export type OrganizationRow = Timestamps & {
  id: string;
  name: string;
  kind: OrganizationKind;
  timezone: string;
  slot_interval_minutes: number;
  created_by: string | null;
};
export type MembershipRow = Timestamps & { id: string; organization_id: string; user_id: string; role: MemberRole };
export type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  professional_id: string | null;
  token_hash: string;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
};
export type ProfessionalTypeRow = { code: string; label: string; sort_order: number; active: boolean };
export type ProfessionalRow = Timestamps & {
  id: string;
  organization_id: string;
  user_id: string | null;
  display_name: string;
  professional_type: string;
  specialty: string | null;
  color: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  deactivated_at: string | null;
};
export type ServiceRow = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  duration_minutes: number;
  description: string | null;
  active: boolean;
  /** Precio de lista en MXN. */
  price: number;
};
export type ProfessionalServiceRow = { organization_id: string; professional_id: string; service_id: string; created_at: string };
export type AvailabilityRuleRow = {
  id: string;
  organization_id: string;
  professional_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  created_at: string;
};
export type TimeOffRow = Timestamps & {
  id: string;
  organization_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  kind: TimeOffKind;
  note: string | null;
  created_by: string | null;
};
export type ContactRow = Timestamps & {
  id: string;
  organization_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  search_name: string;
  phone_digits: string | null;
  created_by: string | null;
};
export type AppointmentRow = Timestamps & {
  id: string;
  organization_id: string;
  professional_id: string;
  service_id: string;
  contact_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  cancellation_reason: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  updated_by: string | null;
  status_changed_at: string;
};
export type AppointmentEventRow = {
  id: number;
  organization_id: string;
  appointment_id: string;
  event_type: AppointmentEventType;
  actor_id: string | null;
  from_status: AppointmentStatus | null;
  to_status: AppointmentStatus | null;
  from_starts_at: string | null;
  from_ends_at: string | null;
  to_starts_at: string | null;
  to_ends_at: string | null;
  from_professional_id: string | null;
  to_professional_id: string | null;
  created_at: string;
};

export type CashSessionRow = {
  id: string;
  organization_id: string;
  opened_by: string | null;
  opened_at: string;
  opening_amount: number;
  opening_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  closing_notes: string | null;
};
export type ChargeRow = {
  id: string;
  organization_id: string;
  session_id: string;
  folio: number;
  contact_id: string | null;
  appointment_id: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: ChargeStatus;
  notes: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  created_at: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
};
export type ChargeItemRow = {
  id: number;
  organization_id: string;
  charge_id: string;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
};
export type PaymentRow = {
  id: string;
  organization_id: string;
  charge_id: string;
  session_id: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  created_at: string;
};
export type CashMovementRow = {
  id: string;
  organization_id: string;
  session_id: string;
  kind: CashMovementKind;
  amount: number;
  concept: string;
  created_by: string | null;
  created_at: string;
};
export type CashSessionTotals = {
  opening_amount: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  movements_in: number;
  movements_out: number;
  expected_cash: number;
  charges_count: number;
  voided_count: number;
  voided_total: number;
};
export type ChargeItemInput = { service_id: string | null; description: string; quantity: number; unit_price: number };
export type PaymentInput = { method: PaymentMethod; amount: number; reference?: string | null };

export type AgendaAppointment = {
  id: string;
  professional_id: string;
  professional_name: string;
  professional_color: string;
  service_id: string;
  service_name: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  /** Hora local del espacio, formato YYYY-MM-DDTHH:MM. */
  local_start: string;
  local_end: string;
  notes: string | null;
};

export type AgendaTimeOff = {
  id: string;
  professional_id: string;
  kind: TimeOffKind;
  note: string | null;
  starts_at: string;
  ends_at: string;
  local_start: string;
  local_end: string;
};

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Insert, Relationships extends Rel[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: Relationships;
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      profiles: Table<ProfileRow, { id: string; full_name?: string; email?: string | null }>;
      organizations: Table<OrganizationRow, { name: string; kind?: OrganizationKind; timezone?: string; slot_interval_minutes?: number }>;
      memberships: Table<
        MembershipRow,
        { organization_id: string; user_id: string; role: MemberRole },
        [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ]
      >;
      invitations: Table<
        InvitationRow,
        { organization_id: string; email: string; role: MemberRole; token_hash: string; expires_at: string; revoked_at?: string | null },
        [
          {
            foreignKeyName: "invitations_professional_fk";
            columns: ["professional_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id", "organization_id"];
          },
        ]
      >;
      professional_types: Table<ProfessionalTypeRow, ProfessionalTypeRow>;
      professionals: Table<
        ProfessionalRow,
        {
          organization_id: string;
          user_id?: string | null;
          display_name: string;
          professional_type?: string;
          specialty?: string | null;
          color?: string;
          email?: string | null;
          phone?: string | null;
          active?: boolean;
        }
      >;
      services: Table<
        ServiceRow,
        { organization_id: string; name: string; duration_minutes: number; description?: string | null; active?: boolean; price?: number }
      >;
      professional_services: Table<
        ProfessionalServiceRow,
        { organization_id: string; professional_id: string; service_id: string },
        [
          {
            foreignKeyName: "professional_services_professional_fk";
            columns: ["professional_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "professional_services_service_fk";
            columns: ["service_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "organization_id"];
          },
        ]
      >;
      availability_rules: Table<
        AvailabilityRuleRow,
        { organization_id: string; professional_id: string; weekday: number; start_time: string; end_time: string }
      >;
      time_off: Table<
        TimeOffRow,
        { organization_id: string; professional_id: string; starts_at: string; ends_at: string; kind?: TimeOffKind; note?: string | null }
      >;
      contacts: Table<ContactRow, { organization_id: string; full_name: string; phone?: string | null; email?: string | null }>;
      appointments: Table<
        AppointmentRow,
        {
          organization_id: string;
          professional_id: string;
          service_id: string;
          contact_id: string;
          starts_at: string;
          ends_at?: string;
          status?: AppointmentStatus;
          notes?: string | null;
          cancellation_reason?: string | null;
          idempotency_key?: string | null;
        },
        [
          {
            foreignKeyName: "appointments_professional_fk";
            columns: ["professional_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "appointments_service_fk";
            columns: ["service_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "appointments_contact_fk";
            columns: ["contact_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id", "organization_id"];
          },
        ]
      >;
      appointment_events: Table<AppointmentEventRow, never>;
      cash_sessions: Table<CashSessionRow, never>;
      charges: Table<ChargeRow, never>;
      charge_items: Table<ChargeItemRow, never>;
      payments: Table<PaymentRow, never>;
      cash_movements: Table<CashMovementRow, never>;
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: {
          p_name: string;
          p_kind: OrganizationKind;
          p_timezone?: string;
          p_also_professional?: boolean;
          p_professional_type?: string;
          p_specialty?: string | null;
          p_display_name?: string | null;
        };
        Returns: string;
      };
      create_invitation: {
        Args: {
          p_organization_id: string;
          p_email: string;
          p_role: MemberRole;
          p_professional_id?: string | null;
          p_valid_days?: number;
        };
        Returns: { invitation_id: string; token: string; expires_at: string }[];
      };
      get_invitation: {
        Args: { p_token: string };
        Returns: {
          organization_name: string | null;
          role: MemberRole | null;
          email_hint: string | null;
          status: "valid" | "expired" | "used" | "revoked" | "invalid";
          email_matches: boolean;
          expires_at: string | null;
        }[];
      };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      set_weekly_schedule: { Args: { p_professional_id: string; p_rules: Json }; Returns: number };
      book_appointment: {
        Args: {
          p_professional_id: string;
          p_service_id: string;
          p_contact_id: string;
          p_local_date: string;
          p_local_time: string;
          p_status?: AppointmentStatus;
          p_notes?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: AppointmentRow;
      };
      reschedule_appointment: {
        Args: { p_appointment_id: string; p_local_date: string; p_local_time: string; p_professional_id?: string | null };
        Returns: AppointmentRow;
      };
      set_appointment_status: {
        Args: { p_appointment_id: string; p_status: AppointmentStatus; p_reason?: string | null };
        Returns: AppointmentRow;
      };
      get_available_slots: {
        Args: {
          p_professional_id: string;
          p_service_id: string;
          p_from: string;
          p_days?: number;
          p_exclude_appointment_id?: string | null;
        };
        Returns: { starts_at: string; ends_at: string; local_start: string }[];
      };
      agenda_appointments: {
        Args: {
          p_organization_id: string;
          p_from: string;
          p_to: string;
          p_professional_id?: string | null;
          p_service_id?: string | null;
          p_statuses?: AppointmentStatus[] | null;
        };
        Returns: AgendaAppointment[];
      };
      agenda_time_off: {
        Args: { p_organization_id: string; p_from: string; p_to: string; p_professional_id?: string | null };
        Returns: AgendaTimeOff[];
      };
      search_contacts: {
        Args: { p_organization_id: string; p_query?: string | null; p_limit?: number };
        Returns: ContactRow[];
      };
      find_similar_contacts: {
        Args: { p_organization_id: string; p_full_name: string; p_phone?: string | null; p_email?: string | null };
        Returns: ContactRow[];
      };
      dashboard_summary: { Args: { p_organization_id: string }; Returns: Json };
      professional_future_appointments: { Args: { p_professional_id: string }; Returns: number };
      open_cash_session: { Args: { p_organization_id: string; p_opening_amount: number; p_notes?: string | null }; Returns: CashSessionRow };
      create_charge: {
        Args: {
          p_organization_id: string;
          p_items: Json;
          p_payments: Json;
          p_discount?: number;
          p_contact_id?: string | null;
          p_appointment_id?: string | null;
          p_notes?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: ChargeRow;
      };
      void_charge: { Args: { p_charge_id: string; p_reason: string }; Returns: ChargeRow };
      add_cash_movement: {
        Args: { p_organization_id: string; p_kind: CashMovementKind; p_amount: number; p_concept: string };
        Returns: CashMovementRow;
      };
      close_cash_session: { Args: { p_session_id: string; p_counted_amount: number; p_notes?: string | null }; Returns: CashSessionRow };
      cash_session_totals: { Args: { p_session_id: string }; Returns: CashSessionTotals[] };
    };
    Enums: {
      member_role: MemberRole;
      organization_kind: OrganizationKind;
      appointment_status: AppointmentStatus;
      time_off_kind: TimeOffKind;
      appointment_event_type: AppointmentEventType;
      payment_method: PaymentMethod;
      charge_status: ChargeStatus;
      cash_movement_kind: CashMovementKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
