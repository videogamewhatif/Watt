// Cliente en memoria para el modo de prueba. Imita la parte de supabase-js que usa
// la aplicación (from/select/eq/in/is/not/order/limit/maybeSingle/single,
// insert/update/delete y rpc), aplica los mismos permisos por rol que las políticas
// RLS y reproduce las reglas de la agenda. No se conecta a ningún servicio.
import "server-only";
import type { ServerClient } from "@/lib/supabase/server";
import { addDays, hhmm, isoWeekday, localParts, minutesOf, zonedToInstant } from "@/lib/tz";
import { contactComputed, type DemoStore, getDemoStore, normalizeSearch, phoneDigits, type Row } from "./data";
import { DEMO_PERSONAS } from "./personas";

type DbError = { message: string; code: string; details: string | null; hint: string | null };
type Result = { data: unknown; error: DbError | null };
type Table = Exclude<keyof DemoStore, "seq">;

const err = (message: string, code = "P0001", details: string | null = null): DbError => ({ message, code, details, hint: null });
const FK: Record<string, string> = {
  organizations: "organization_id",
  professionals: "professional_id",
  services: "service_id",
  contacts: "contact_id",
};
const ACTIVE = ["pending", "confirmed"];
const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;
const plusMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

// ---------------------------------------------------------------------------
// Permisos (equivalentes a las políticas RLS de supabase/migrations)
// ---------------------------------------------------------------------------
class Viewer {
  constructor(
    readonly db: DemoStore,
    readonly uid: string,
  ) {}
  private orgs(roles: string[]) {
    return new Set(this.db.memberships.filter((m) => m.user_id === this.uid && roles.includes(m.role)).map((m) => m.organization_id));
  }
  get member() {
    return this.orgs(["admin", "reception", "professional"]);
  }
  get staff() {
    return this.orgs(["admin", "reception"]);
  }
  get admin() {
    return this.orgs(["admin"]);
  }
  get ownProfessionals() {
    return new Set(this.db.professionals.filter((p) => p.user_id === this.uid).map((p) => p.id));
  }
  get ownContacts() {
    const own = this.ownProfessionals;
    return new Set(this.db.appointments.filter((a) => own.has(a.professional_id)).map((a) => a.contact_id));
  }
  get coMembers() {
    const member = this.member;
    return new Set(this.db.memberships.filter((m) => member.has(m.organization_id)).map((m) => m.user_id));
  }

  canSee(table: Table, r: Row): boolean {
    switch (table) {
      case "profiles":
        return r.id === this.uid || this.coMembers.has(r.id);
      case "organizations":
        return this.member.has(r.id);
      case "memberships":
        return r.user_id === this.uid || this.admin.has(r.organization_id);
      case "invitations":
        return this.admin.has(r.organization_id);
      case "professional_types":
        return true;
      case "professionals":
        return this.staff.has(r.organization_id) || this.ownProfessionals.has(r.id);
      case "services":
        return this.member.has(r.organization_id);
      case "professional_services":
      case "availability_rules":
      case "time_off":
      case "appointments":
        return this.staff.has(r.organization_id) || this.ownProfessionals.has(r.professional_id);
      case "contacts":
        return (
          this.staff.has(r.organization_id) ||
          (r.created_by === this.uid && this.member.has(r.organization_id)) ||
          this.ownContacts.has(r.id)
        );
      case "appointment_events": {
        const a = this.db.appointments.find((x) => x.id === r.appointment_id);
        return Boolean(a && this.canSee("appointments", a));
      }
    }
  }

  canWrite(table: Table, op: "insert" | "update" | "delete", r: Row): boolean {
    const org = r.organization_id;
    switch (table) {
      case "profiles":
        return op === "update" && r.id === this.uid;
      case "organizations":
        return op === "update" && this.admin.has(r.id);
      case "memberships":
        return op !== "insert" && (this.admin.has(org) || (op === "delete" && r.user_id === this.uid));
      case "invitations":
        return op !== "insert" && this.admin.has(org);
      case "professionals":
      case "services":
        return op !== "delete" && this.admin.has(org);
      case "professional_services":
        return op !== "update" && this.admin.has(org);
      case "availability_rules":
      case "time_off":
        return this.admin.has(org);
      case "contacts":
        if (op === "insert") return this.member.has(org);
        if (op === "delete") return this.admin.has(org);
        return this.staff.has(org) || (r.created_by === this.uid && this.member.has(org));
      case "appointments":
        return op === "update" && (this.staff.has(org) || this.ownProfessionals.has(r.professional_id));
      default:
        return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Proyección de columnas, incluidas relaciones "alias:tabla(columnas)"
// ---------------------------------------------------------------------------
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(v: Viewer, row: Row, cols: string): Row {
  const out: Row = {};
  for (const item of splitTop(cols)) {
    const embed = /^(?:(\w+):)?(\w+)\(([\s\S]*)\)$/.exec(item);
    if (embed) {
      const [, alias, target, inner] = embed;
      const ref = (v.db[target as Table] as Row[]).find((r) => r.id === row[FK[target]] && v.canSee(target as Table, r));
      out[alias ?? target] = ref ? project(v, ref, inner) : null;
    } else if (item === "*") Object.assign(out, row);
    else out[item] = row[item];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Constructor de consultas
// ---------------------------------------------------------------------------
class DemoQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private cols = "*";
  private returning = false;
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private payload: Row | Row[] | null = null;

  constructor(
    private v: Viewer,
    private table: Table,
  ) {}

  select(cols = "*") {
    this.cols = cols;
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  not(col: string, op: string, value: unknown) {
    this.filters.push((r) => (op === "is" && value === null ? r[col] != null : r[col] !== value));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A = Result, B = never>(onOk?: ((value: Result) => A | PromiseLike<A>) | null, onErr?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(onOk, onErr);
  }

  private rows(): Row[] {
    return (this.v.db[this.table] as Row[]).filter((r) => this.v.canSee(this.table, r) && this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]): Result {
    let list = rows;
    for (const { col, asc } of [...this.orders].reverse()) {
      list = [...list].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        if (x === y) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.max !== null) list = list.slice(0, this.max);
    const data = list.map((r) => project(this.v, r, this.cols));
    if (this.mode === "many") return { data, error: null };
    if (data.length === 1) return { data: data[0], error: null };
    if (data.length === 0 && this.mode === "maybe") return { data: null, error: null };
    return { data: null, error: err("Se esperaba una sola fila", "PGRST116") };
  }

  private run(): Result {
    const { v, table } = this;
    const db = v.db;
    if (this.op === "select") return this.shape(this.rows());

    if (this.op === "insert") {
      const inserted: Row[] = [];
      for (const values of Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) {
        const row = withDefaults(table, values, v.uid);
        if (!v.canWrite(table, "insert", row)) return { data: null, error: err("new row violates row-level security policy", "42501") };
        const problem = validateInsert(db, table, row);
        if (problem) return { data: null, error: problem };
        (db[table] as Row[]).push(row);
        inserted.push(row);
      }
      return this.returning ? this.shape(inserted) : { data: null, error: null };
    }

    const targets = this.rows().filter((r) => v.canWrite(table, this.op as "update" | "delete", r));
    if (this.op === "update") {
      for (const row of targets) {
        const next = { ...row, ...this.payload, updated_at: new Date().toISOString() };
        const problem = validateUpdate(v, table, row, next);
        if (problem) return { data: null, error: problem };
        Object.assign(row, table === "contacts" ? contactComputed(next) : next);
      }
      return this.returning ? this.shape(targets) : { data: null, error: null };
    }

    for (const row of targets) {
      const problem = validateDelete(db, table, row);
      if (problem) return { data: null, error: problem };
    }
    db[table] = (db[table] as Row[]).filter((r) => !targets.includes(r)) as never;
    return this.returning ? this.shape(targets) : { data: null, error: null };
  }
}

function withDefaults(table: Table, values: Row, uid: string): Row {
  const now = new Date().toISOString();
  const base: Row = { id: crypto.randomUUID(), created_at: now, updated_at: now };
  switch (table) {
    case "professionals":
      return { ...base, user_id: null, professional_type: "medico", specialty: null, color: "#0f766e", email: null, phone: null, active: true, deactivated_at: null, ...values };
    case "services":
      return { ...base, description: null, active: true, ...values };
    case "contacts":
      return contactComputed({ ...base, phone: null, email: null, ...values, full_name: String(values.full_name ?? "").trim(), created_by: uid });
    case "time_off":
      return { ...base, kind: "other", note: null, ...values, created_by: uid };
    case "professional_services":
      return { created_at: now, ...values };
    default:
      return { ...base, ...values };
  }
}

function validateInsert(db: DemoStore, table: Table, row: Row): DbError | null {
  const sameOrg = (t: Table, id: string) => (db[t] as Row[]).some((r) => r.id === id && r.organization_id === row.organization_id);
  if (table === "contacts" && !row.phone && !row.email) return err("violates check constraint", "23514");
  if (table === "professional_services") {
    if (!sameOrg("professionals", row.professional_id) || !sameOrg("services", row.service_id)) return err("violates foreign key constraint", "23503");
    if (db.professional_services.some((r) => r.professional_id === row.professional_id && r.service_id === row.service_id)) return err("duplicate key", "23505");
  }
  if (table === "time_off") {
    if (!sameOrg("professionals", row.professional_id)) return err("professional_not_found");
    if (row.ends_at <= row.starts_at) return err("violates check constraint", "23514");
    const conflicts = db.appointments.filter(
      (a) => a.professional_id === row.professional_id && ACTIVE.includes(a.status) && overlaps(a.starts_at, a.ends_at, row.starts_at, row.ends_at),
    ).length;
    if (conflicts > 0) return err("time_off_conflict", "P0001", String(conflicts));
  }
  return null;
}

function validateUpdate(v: Viewer, table: Table, before: Row, next: Row): DbError | null {
  const db = v.db;
  if (next.organization_id !== before.organization_id) return err("organization_immutable");
  if (table === "organizations") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: next.timezone });
    } catch {
      return err("invalid_timezone");
    }
  }
  if (table === "professionals") {
    if (next.active !== before.active) next.deactivated_at = next.active ? null : new Date().toISOString();
    if (next.user_id && next.user_id !== before.user_id) {
      if (!db.memberships.some((m) => m.organization_id === next.organization_id && m.user_id === next.user_id)) return err("violates foreign key constraint", "23503");
      if (db.professionals.some((p) => p.id !== next.id && p.organization_id === next.organization_id && p.user_id === next.user_id)) return err("duplicate key", "23505");
    }
  }
  if (table === "contacts" && !next.phone && !next.email) return err("violates check constraint", "23514");
  if (table === "memberships" && before.role === "admin" && next.role !== "admin" && otherAdmins(db, before) === 0) return err("last_admin");
  if (table === "appointments" && (next.notes !== before.notes || next.pet_name !== before.pet_name)) {
    addEvent(db, next, "details_updated", v.uid);
  }
  return null;
}

function validateDelete(db: DemoStore, table: Table, row: Row): DbError | null {
  if (table === "memberships" && row.role === "admin" && otherAdmins(db, row) === 0) return err("last_admin");
  if (table === "memberships") {
    for (const p of db.professionals) if (p.organization_id === row.organization_id && p.user_id === row.user_id) p.user_id = null;
  }
  if (table === "contacts" && db.appointments.some((a) => a.contact_id === row.id)) return err("violates foreign key constraint", "23503");
  return null;
}

function otherAdmins(db: DemoStore, m: Row) {
  return db.memberships.filter((x) => x.organization_id === m.organization_id && x.role === "admin" && x.id !== m.id).length;
}

function addEvent(db: DemoStore, a: Row, type: string, actor: string, extra: Row = {}) {
  db.appointment_events.push({
    id: ++db.seq,
    organization_id: a.organization_id,
    appointment_id: a.id,
    event_type: type,
    actor_id: actor,
    from_status: null,
    to_status: null,
    from_starts_at: null,
    from_ends_at: null,
    to_starts_at: null,
    to_ends_at: null,
    from_professional_id: null,
    to_professional_id: null,
    created_at: new Date().toISOString(),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Reglas de agenda (equivalentes a los triggers y funciones SQL)
// ---------------------------------------------------------------------------
function orgOf(db: DemoStore, organizationId: string): Row {
  return db.organizations.find((o) => o.id === organizationId)!;
}

function localRange(iso: string, tz: string) {
  const p = localParts(iso, tz);
  return `${p.date}T${p.time}`;
}

function slotProblem(db: DemoStore, prof: Row, starts: string, ends: string, excludeId: string | null): string | null {
  const tz = orgOf(db, prof.organization_id).timezone;
  const s = localParts(starts, tz);
  const e = localParts(ends, tz);
  const startMin = s.minutes;
  const endMin = e.date > s.date ? 1440 + e.minutes : e.minutes;
  const fits = db.availability_rules.some(
    (r) => r.professional_id === prof.id && r.weekday === isoWeekday(s.date) && startMin >= minutesOf(r.start_time) && endMin <= minutesOf(r.end_time),
  );
  if (!fits) return "outside_schedule";
  if (db.time_off.some((t) => t.professional_id === prof.id && overlaps(t.starts_at, t.ends_at, starts, ends))) return "blocked";
  if (
    db.appointments.some(
      (a) => a.professional_id === prof.id && ACTIVE.includes(a.status) && a.id !== excludeId && overlaps(a.starts_at, a.ends_at, starts, ends),
    )
  )
    return "slot_taken";
  return null;
}

function checkBookable(db: DemoStore, prof: Row, serviceId: string, starts: string, ends: string, excludeId: string | null): DbError | null {
  if (!prof.active) return err("professional_inactive");
  const service = db.services.find((s) => s.id === serviceId);
  if (!service?.active) return err("service_inactive");
  if (!db.professional_services.some((ps) => ps.professional_id === prof.id && ps.service_id === serviceId)) return err("service_not_offered");
  if (starts <= new Date().toISOString()) return err("appointment_in_past");
  const problem = slotProblem(db, prof, starts, ends, excludeId);
  return problem ? err(problem) : null;
}

function canManageProfessional(v: Viewer, prof: Row | undefined) {
  return Boolean(prof && (v.staff.has(prof.organization_id) || prof.user_id === v.uid));
}

function availableSlots(v: Viewer, args: Row): Result {
  const db = v.db;
  const prof = db.professionals.find((p) => p.id === args.p_professional_id);
  if (!canManageProfessional(v, prof)) return { data: null, error: err("forbidden", "42501") };
  const days = args.p_days ?? 1;
  if (days < 1 || days > 31) return { data: null, error: err("invalid_range") };
  if (!prof!.active) return { data: [], error: null };
  const service = db.services.find((s) => s.id === args.p_service_id && s.active);
  const offered = db.professional_services.some((ps) => ps.professional_id === prof!.id && ps.service_id === args.p_service_id);
  if (!service || !offered) return { data: [], error: null };
  const org = orgOf(db, prof!.organization_id);
  const now = new Date().toISOString();
  const out: Row[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(args.p_from, i);
    const windows = db.availability_rules
      .filter((r) => r.professional_id === prof!.id && r.weekday === isoWeekday(day))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (const w of windows) {
      for (let m = minutesOf(w.start_time); m + service.duration_minutes <= minutesOf(w.end_time); m += org.slot_interval_minutes) {
        const startsAt = zonedToInstant(day, hhmm(m), org.timezone).toISOString();
        const endsAt = plusMinutes(startsAt, service.duration_minutes);
        if (startsAt <= now) continue;
        if (db.time_off.some((t) => t.professional_id === prof!.id && overlaps(t.starts_at, t.ends_at, startsAt, endsAt))) continue;
        if (
          db.appointments.some(
            (a) =>
              a.professional_id === prof!.id &&
              ACTIVE.includes(a.status) &&
              a.id !== args.p_exclude_appointment_id &&
              overlaps(a.starts_at, a.ends_at, startsAt, endsAt),
          )
        )
          continue;
        out.push({ starts_at: startsAt, ends_at: endsAt, local_start: `${day}T${hhmm(m)}` });
      }
    }
  }
  return { data: out, error: null };
}

function bookAppointment(v: Viewer, a: Row): Result {
  const db = v.db;
  const prof = db.professionals.find((p) => p.id === a.p_professional_id && v.canSee("professionals", p));
  if (!prof) return { data: null, error: err("professional_not_found") };
  const isStaff = v.staff.has(prof.organization_id);
  if (!isStaff && prof.user_id !== v.uid) return { data: null, error: err("forbidden", "42501") };
  if (a.p_idempotency_key) {
    const existing = db.appointments.find((x) => x.organization_id === prof.organization_id && x.idempotency_key === a.p_idempotency_key);
    if (existing) return { data: existing, error: null };
  }
  const service = db.services.find((s) => s.id === a.p_service_id && s.organization_id === prof.organization_id);
  if (!service) return { data: null, error: err("service_not_found") };
  const contact = db.contacts.find((c) => c.id === a.p_contact_id);
  if (!contact || contact.organization_id !== prof.organization_id) return { data: null, error: err("violates foreign key constraint", "23503") };
  if (!isStaff && contact.created_by !== v.uid && !v.ownContacts.has(contact.id)) return { data: null, error: err("contact_not_accessible", "42501") };
  const status = a.p_status ?? "pending";
  if (!ACTIVE.includes(status)) return { data: null, error: err("invalid_initial_status") };
  const tz = orgOf(db, prof.organization_id).timezone;
  const startsAt = zonedToInstant(a.p_local_date, String(a.p_local_time).slice(0, 5), tz).toISOString();
  const endsAt = plusMinutes(startsAt, service.duration_minutes);
  const problem = checkBookable(db, prof, service.id, startsAt, endsAt, null);
  if (problem) return { data: null, error: problem };
  const now = new Date().toISOString();
  const row: Row = {
    id: crypto.randomUUID(),
    organization_id: prof.organization_id,
    professional_id: prof.id,
    service_id: service.id,
    contact_id: contact.id,
    pet_name: a.p_pet_name?.trim() || null,
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    notes: a.p_notes?.trim() || null,
    cancellation_reason: null,
    idempotency_key: a.p_idempotency_key ?? null,
    created_by: v.uid,
    updated_by: v.uid,
    created_at: now,
    updated_at: now,
    status_changed_at: now,
  };
  db.appointments.push(row);
  addEvent(db, row, "created", v.uid, { to_status: status, to_starts_at: startsAt, to_ends_at: endsAt, to_professional_id: prof.id });
  return { data: row, error: null };
}

function rescheduleAppointment(v: Viewer, a: Row): Result {
  const db = v.db;
  const appt = db.appointments.find((x) => x.id === a.p_appointment_id && v.canSee("appointments", x));
  if (!appt) return { data: null, error: err("appointment_not_found") };
  if (!ACTIVE.includes(appt.status)) return { data: null, error: err("appointment_closed") };
  const target = db.professionals.find((p) => p.id === (a.p_professional_id ?? appt.professional_id));
  if (!target || target.organization_id !== appt.organization_id) return { data: null, error: err("professional_not_found") };
  if (!v.staff.has(appt.organization_id) && target.user_id !== v.uid) return { data: null, error: err("forbidden", "42501") };
  const tz = orgOf(db, appt.organization_id).timezone;
  const startsAt = zonedToInstant(a.p_local_date, String(a.p_local_time).slice(0, 5), tz).toISOString();
  const duration = (new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60000;
  const endsAt = plusMinutes(startsAt, duration);
  const problem = checkBookable(db, target, appt.service_id, startsAt, endsAt, appt.id);
  if (problem) return { data: null, error: problem };
  addEvent(db, appt, "rescheduled", v.uid, {
    from_starts_at: appt.starts_at,
    from_ends_at: appt.ends_at,
    to_starts_at: startsAt,
    to_ends_at: endsAt,
    from_professional_id: appt.professional_id,
    to_professional_id: target.id,
  });
  Object.assign(appt, { starts_at: startsAt, ends_at: endsAt, professional_id: target.id, updated_by: v.uid, updated_at: new Date().toISOString() });
  return { data: appt, error: null };
}

function setStatus(v: Viewer, a: Row): Result {
  const db = v.db;
  const appt = db.appointments.find((x) => x.id === a.p_appointment_id && v.canSee("appointments", x));
  if (!appt) return { data: null, error: err("appointment_not_found") };
  const from = appt.status;
  const to = a.p_status;
  if (from !== to) {
    const started = appt.starts_at <= new Date().toISOString();
    const allowed =
      (ACTIVE.includes(from) && ["attended", "no_show"].includes(to)) ||
      (from === "pending" && ["confirmed", "cancelled"].includes(to)) ||
      (from === "confirmed" && to === "cancelled") ||
      (["attended", "no_show"].includes(from) && ["attended", "no_show"].includes(to));
    if (!allowed) return { data: null, error: err("invalid_status_transition") };
    if (ACTIVE.includes(from) && ["attended", "no_show"].includes(to) && !started) return { data: null, error: err("appointment_not_started") };
    addEvent(db, appt, "status_changed", v.uid, { from_status: from, to_status: to });
  }
  Object.assign(appt, {
    status: to,
    cancellation_reason: to === "cancelled" ? a.p_reason?.trim() || null : null,
    status_changed_at: new Date().toISOString(),
    updated_by: v.uid,
  });
  return { data: appt, error: null };
}

function agendaRows(v: Viewer, a: Row): Result {
  const db = v.db;
  const org = db.organizations.find((o) => o.id === a.p_organization_id && v.canSee("organizations", o));
  if (!org) return { data: [], error: null };
  const lo = zonedToInstant(a.p_from, "00:00", org.timezone).toISOString();
  const hi = zonedToInstant(addDays(a.p_to, 1), "00:00", org.timezone).toISOString();
  const rows = db.appointments
    .filter((x) => x.organization_id === org.id && v.canSee("appointments", x) && x.starts_at >= lo && x.starts_at < hi)
    .filter((x) => !a.p_professional_id || x.professional_id === a.p_professional_id)
    .filter((x) => !a.p_service_id || x.service_id === a.p_service_id)
    .filter((x) => !a.p_statuses || a.p_statuses.includes(x.status))
    .flatMap((x) => {
      const p = db.professionals.find((r) => r.id === x.professional_id && v.canSee("professionals", r));
      const s = db.services.find((r) => r.id === x.service_id);
      const c = db.contacts.find((r) => r.id === x.contact_id && v.canSee("contacts", r));
      if (!p || !s || !c) return [];
      return [
        {
          id: x.id,
          professional_id: x.professional_id,
          professional_name: p.display_name,
          professional_color: p.color,
          service_id: x.service_id,
          service_name: s.name,
          contact_id: x.contact_id,
          contact_name: c.full_name,
          contact_phone: c.phone,
          contact_email: c.email,
          pet_name: x.pet_name,
          status: x.status,
          starts_at: x.starts_at,
          ends_at: x.ends_at,
          local_start: localRange(x.starts_at, org.timezone),
          local_end: localRange(x.ends_at, org.timezone),
          notes: x.notes,
        },
      ];
    })
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at) || x.professional_name.localeCompare(y.professional_name));
  return { data: rows, error: null };
}

function agendaTimeOff(v: Viewer, a: Row): Result {
  const db = v.db;
  const org = db.organizations.find((o) => o.id === a.p_organization_id && v.canSee("organizations", o));
  if (!org) return { data: [], error: null };
  const lo = zonedToInstant(a.p_from, "00:00", org.timezone).toISOString();
  const hi = zonedToInstant(addDays(a.p_to, 1), "00:00", org.timezone).toISOString();
  const rows = db.time_off
    .filter((t) => t.organization_id === org.id && v.canSee("time_off", t) && overlaps(t.starts_at, t.ends_at, lo, hi))
    .filter((t) => !a.p_professional_id || t.professional_id === a.p_professional_id)
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    .map((t) => ({
      id: t.id,
      professional_id: t.professional_id,
      kind: t.kind,
      note: t.note,
      starts_at: t.starts_at,
      ends_at: t.ends_at,
      local_start: localRange(t.starts_at, org.timezone),
      local_end: localRange(t.ends_at, org.timezone),
    }));
  return { data: rows, error: null };
}

function dashboard(v: Viewer, a: Row): Result {
  const db = v.db;
  const org = db.organizations.find((o) => o.id === a.p_organization_id && v.canSee("organizations", o));
  if (!org) return { data: null, error: err("forbidden", "42501") };
  const today = localParts(new Date(), org.timezone).date;
  const todayRows = (agendaRows(v, { p_organization_id: org.id, p_from: today, p_to: today }).data as Row[]) ?? [];
  const count = (s: string) => todayRows.filter((r) => r.status === s).length;
  const now = new Date().toISOString();
  const visible = db.appointments.filter((x) => x.organization_id === org.id && v.canSee("appointments", x));
  const next = visible.filter((x) => ACTIVE.includes(x.status) && x.starts_at > now).sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0];
  const inOrg = (t: Table) => (db[t] as Row[]).some((r) => r.organization_id === org.id && v.canSee(t, r));
  return {
    data: {
      today,
      timezone: org.timezone,
      today_total: todayRows.filter((r) => r.status !== "cancelled").length,
      today_pending: count("pending"),
      today_confirmed: count("confirmed"),
      today_attended: count("attended"),
      today_no_show: count("no_show"),
      today_cancelled: count("cancelled"),
      upcoming_pending: visible.filter((x) => x.status === "pending" && x.starts_at > now).length,
      next_appointment: next
        ? {
            id: next.id,
            starts_at: next.starts_at,
            status: next.status,
            local_start: localRange(next.starts_at, org.timezone),
            contact_name: db.contacts.find((c) => c.id === next.contact_id)?.full_name ?? "",
            service_name: db.services.find((s) => s.id === next.service_id)?.name ?? "",
            professional_name: db.professionals.find((p) => p.id === next.professional_id)?.display_name ?? "",
          }
        : null,
      setup: {
        has_professional: inOrg("professionals"),
        has_service: inOrg("services"),
        has_assignment: inOrg("professional_services"),
        has_schedule: inOrg("availability_rules"),
        has_appointment: inOrg("appointments"),
      },
    },
    error: null,
  };
}

function searchContacts(v: Viewer, a: Row): Result {
  const q = String(a.p_query ?? "").trim();
  const digits = phoneDigits(q);
  const rows = v.db.contacts
    .filter((c) => c.organization_id === a.p_organization_id && v.canSee("contacts", c))
    .filter(
      (c) =>
        !q ||
        c.search_name.includes(normalizeSearch(q)) ||
        (digits && digits.length >= 3 && (c.phone_digits ?? "").includes(digits)) ||
        (c.email ?? "").toLowerCase().includes(q.toLowerCase()),
    )
    .sort((x, y) => x.search_name.localeCompare(y.search_name))
    .slice(0, Math.min(Math.max(a.p_limit ?? 25, 1), 100));
  return { data: rows, error: null };
}

function similarContacts(v: Viewer, a: Row): Result {
  const phone = phoneDigits(a.p_phone);
  const email = String(a.p_email ?? "").trim().toLowerCase();
  const name = normalizeSearch(String(a.p_full_name ?? "").trim().replace(/\s+/g, " "));
  const rows = v.db.contacts
    .filter((c) => c.organization_id === a.p_organization_id && v.canSee("contacts", c))
    .filter(
      (c) =>
        (phone && phone.length >= 7 && (c.phone_digits ?? "").slice(-10) === phone.slice(-10)) ||
        (email && (c.email ?? "").toLowerCase() === email) ||
        (name.length >= 3 && c.search_name === name),
    )
    .slice(0, 5);
  return { data: rows, error: null };
}

function setWeeklySchedule(v: Viewer, a: Row): Result {
  const db = v.db;
  const prof = db.professionals.find((p) => p.id === a.p_professional_id);
  if (!prof || !v.admin.has(prof.organization_id)) return { data: null, error: err("forbidden", "42501") };
  const rules = (a.p_rules as Row[]).map((r) => ({
    id: crypto.randomUUID(),
    organization_id: prof.organization_id,
    professional_id: prof.id,
    weekday: Number(r.weekday),
    start_time: `${String(r.start_time).slice(0, 5)}:00`,
    end_time: `${String(r.end_time).slice(0, 5)}:00`,
    created_at: new Date().toISOString(),
  }));
  for (const r of rules) {
    if (minutesOf(r.end_time) <= minutesOf(r.start_time)) return { data: null, error: err("violates check constraint", "23514") };
    const clash = rules.some(
      (o) => o !== r && o.weekday === r.weekday && minutesOf(o.start_time) < minutesOf(r.end_time) && minutesOf(r.start_time) < minutesOf(o.end_time),
    );
    if (clash) return { data: null, error: err("conflicting key value violates exclusion constraint \"availability_rules_no_overlap\"", "23P01") };
  }
  db.availability_rules = [...db.availability_rules.filter((r) => r.professional_id !== prof.id), ...rules];
  const now = new Date().toISOString();
  const outside = db.appointments.filter(
    (x) => x.professional_id === prof.id && ACTIVE.includes(x.status) && x.starts_at > now && slotProblem(db, prof, x.starts_at, x.ends_at, x.id) === "outside_schedule",
  ).length;
  return { data: outside, error: null };
}

function createOrganization(v: Viewer, a: Row): Result {
  const db = v.db;
  const now = new Date().toISOString();
  const name = String(a.p_name ?? "").trim();
  if (name.length < 2) return { data: null, error: err("violates check constraint", "23514") };
  const tz = a.p_timezone || "America/Mexico_City";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return { data: null, error: err("invalid_timezone") };
  }
  const org = { id: crypto.randomUUID(), name, kind: a.p_kind, timezone: tz, slot_interval_minutes: 15, created_by: v.uid, created_at: now, updated_at: now };
  db.organizations.push(org);
  db.memberships.push({ id: crypto.randomUUID(), organization_id: org.id, user_id: v.uid, role: "admin", created_at: now, updated_at: now });
  if (a.p_also_professional) {
    const profile = db.profiles.find((p) => p.id === v.uid);
    db.professionals.push(
      withDefaults(
        "professionals",
        {
          organization_id: org.id,
          user_id: v.uid,
          display_name: a.p_display_name?.trim() || profile?.full_name || "Profesional",
          professional_type: a.p_professional_type ?? "medico",
          specialty: a.p_specialty ?? null,
        },
        v.uid,
      ),
    );
  }
  return { data: org.id, error: null };
}

function createInvitation(v: Viewer, a: Row): Result {
  const db = v.db;
  if (!v.admin.has(a.p_organization_id)) return { data: null, error: err("forbidden", "42501") };
  const email = String(a.p_email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { data: null, error: err("invalid_email") };
  const memberEmails = db.memberships
    .filter((m) => m.organization_id === a.p_organization_id)
    .map((m) => db.profiles.find((p) => p.id === m.user_id)?.email);
  if (memberEmails.includes(email)) return { data: null, error: err("already_member") };
  if (a.p_professional_id) {
    const prof = db.professionals.find((p) => p.id === a.p_professional_id && p.organization_id === a.p_organization_id && !p.user_id);
    if (!prof || a.p_role === "reception") return { data: null, error: err("invalid_professional_link") };
  }
  const now = new Date();
  for (const inv of db.invitations) if (inv.organization_id === a.p_organization_id && inv.email === email && !inv.accepted_at && !inv.revoked_at) inv.revoked_at = now.toISOString();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const expires = new Date(now.getTime() + (a.p_valid_days ?? 7) * 86400000).toISOString();
  const id = crypto.randomUUID();
  db.invitations.push({
    id,
    organization_id: a.p_organization_id,
    email,
    role: a.p_role,
    professional_id: a.p_professional_id ?? null,
    token_hash: `demo:${token}`,
    expires_at: expires,
    created_by: v.uid,
    created_at: now.toISOString(),
    accepted_at: null,
    accepted_by: null,
    revoked_at: null,
  });
  return { data: [{ invitation_id: id, token, expires_at: expires }], error: null };
}

function getInvitation(v: Viewer, a: Row): Result {
  const inv = v.db.invitations.find((i) => i.token_hash === `demo:${a.p_token}`);
  if (!inv) return { data: [{ organization_name: null, role: null, email_hint: null, status: "invalid", email_matches: false, expires_at: null }], error: null };
  const me = v.db.profiles.find((p) => p.id === v.uid);
  const status = inv.revoked_at ? "revoked" : inv.accepted_at ? "used" : inv.expires_at <= new Date().toISOString() ? "expired" : "valid";
  return {
    data: [
      {
        organization_name: orgOf(v.db, inv.organization_id).name,
        role: inv.role,
        email_hint: `${inv.email.slice(0, 2)}•••@${inv.email.split("@")[1]}`,
        status,
        email_matches: me?.email === inv.email,
        expires_at: inv.expires_at,
      },
    ],
    error: null,
  };
}

const RPC: Record<string, (v: Viewer, args: Row) => Result> = {
  get_available_slots: availableSlots,
  book_appointment: bookAppointment,
  reschedule_appointment: rescheduleAppointment,
  set_appointment_status: setStatus,
  agenda_appointments: agendaRows,
  agenda_time_off: agendaTimeOff,
  dashboard_summary: dashboard,
  search_contacts: searchContacts,
  find_similar_contacts: similarContacts,
  set_weekly_schedule: setWeeklySchedule,
  create_organization: createOrganization,
  create_invitation: createInvitation,
  get_invitation: getInvitation,
  accept_invitation: () => ({ data: null, error: err("demo_unavailable") }),
  professional_future_appointments: (v, a) => ({
    data: v.db.appointments.filter(
      (x) => x.professional_id === a.p_professional_id && v.canSee("appointments", x) && ACTIVE.includes(x.status) && x.starts_at > new Date().toISOString(),
    ).length,
    error: null,
  }),
};

class DemoRpc implements PromiseLike<Result> {
  private mode: "as-is" | "single" | "maybe" = "as-is";
  constructor(
    private v: Viewer,
    private fn: string,
    private args: Row,
  ) {}
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  then<A = Result, B = never>(onOk?: ((value: Result) => A | PromiseLike<A>) | null, onErr?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => {
        const impl = RPC[this.fn];
        if (!impl) return { data: null, error: err("demo_unavailable") };
        const result = impl(this.v, this.args ?? {});
        if (this.mode !== "as-is" && Array.isArray(result.data)) return { data: result.data[0] ?? null, error: result.error };
        return result;
      })
      .then(onOk, onErr);
  }
}

/** Cliente con la forma de supabase-js que opera sobre los datos ficticios en memoria. */
export function createDemoClient(userId: string): ServerClient {
  const persona = DEMO_PERSONAS.find((p) => p.id === userId);
  const user = { id: userId, email: persona?.email ?? "", user_metadata: { full_name: persona?.name ?? "" } };
  const unavailable = async () => ({ data: null, error: { code: "demo_unavailable", message: "No disponible en el modo de prueba" } });
  return {
    from: (table: Table) => new DemoQuery(new Viewer(getDemoStore(), userId), table),
    rpc: (fn: string, args: Row) => new DemoRpc(new Viewer(getDemoStore(), userId), fn, args),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: userId } }, error: null }),
      signOut: async () => ({ error: null }),
      updateUser: unavailable,
      signInWithPassword: unavailable,
      signUp: unavailable,
      resetPasswordForEmail: unavailable,
    },
  } as unknown as ServerClient;
}
