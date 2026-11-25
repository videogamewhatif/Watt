"use client";

import { CalendarClock, Clock, Minus, PenLine, Percent, Plus, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ContactPicker } from "@/features/agenda/components/contact-picker";
import type { ContactSummary } from "@/features/patients/actions";
import { chargeTotals, formatMoney, fromCents, netPayments, parseMoney, toCents } from "@/lib/money";
import { formatDuration, splitLocal } from "@/lib/tz";
import type { PosService, Receivable } from "../queries";
import { createCharge } from "../actions";
import { INITIAL_PAY, PAY_VERB, type PayState, PaymentPicker, resolvePayment, type SaleDone, SaleDoneDialog } from "./payment";

type Line = {
  key: string;
  serviceId: string | null;
  description: string;
  quantity: number;
  /** Solo en conceptos libres; los servicios usan el precio de lista. */
  unitPrice: number;
  /** La línea que viene de una cita por cobrar. */
  appointment?: boolean;
};

type Tab = "receivables" | "services";

const DISCOUNTS = [5, 10, 15, 20, 25, 50];
const STEP = "inline-flex size-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink hover:bg-sunken";
const uid = () => crypto.randomUUID();

type Props = {
  organizationId: string;
  services: PosService[];
  receivables: Receivable[];
  dateLabel: string;
  sessionLabel: string;
};

/** Punto de venta: se eligen tarjetas del catálogo o citas por cobrar, se arma el ticket y se cobra. */
export function PointOfSale({ organizationId, services, receivables, dateLabel, sessionLabel }: Props) {
  const catalog = new Map(services.map((s) => [s.id, s]));
  const [tab, setTab] = useState<Tab>(receivables.length ? "receivables" : "services");
  const [contact, setContact] = useState<ContactSummary | null>(null);
  const [appointment, setAppointment] = useState<Receivable | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [discountChoice, setDiscountChoice] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [freeOpen, setFreeOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [pay, setPay] = useState<PayState>(INITIAL_PAY);
  const [idempotencyKey, setIdempotencyKey] = useState(uid);
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<SaleDone | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { notify } = useToast();

  // ---- Totales -----------------------------------------------------------
  const priced = lines.map((l) => ({ quantity: l.quantity, unitPrice: l.serviceId ? (catalog.get(l.serviceId)?.price ?? 0) : l.unitPrice }));
  const subtotal = chargeTotals(priced, 0).subtotal;
  const discount = discountChoice === "custom" ? (discountAmount.trim() === "" ? 0 : parseMoney(discountAmount)) : fromCents(Math.round((toCents(subtotal) * Number(discountChoice)) / 100));
  const discountOk = discount !== null && (discount === 0 || discount < subtotal);
  const totals = chargeTotals(priced, discountOk ? (discount ?? 0) : 0);
  const linesOk = lines.every((l) => !l.serviceId || catalog.has(l.serviceId));
  const resolved = resolvePayment(totals.total, pay);
  const ready = lines.length > 0 && linesOk && discountOk && totals.total > 0 && !resolved.problem;
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const inTicket = (serviceId: string) => lines.filter((l) => l.serviceId === serviceId && !l.appointment).reduce((n, l) => n + l.quantity, 0);

  // ---- Acciones del ticket -----------------------------------------------
  const addService = (s: PosService) =>
    setLines((all) => {
      const existing = all.find((l) => l.serviceId === s.id && !l.appointment);
      if (existing) return all.map((l) => (l === existing ? { ...l, quantity: Math.min(l.quantity + 1, 999) } : l));
      return [...all, { key: uid(), serviceId: s.id, description: s.name, quantity: 1, unitPrice: 0 }];
    });

  const chooseAppointment = (r: Receivable) => {
    setAppointment(r);
    setContact({ id: r.contactId, full_name: r.contactName, phone: r.contactPhone, email: r.contactEmail });
    setLines((all) => [{ key: uid(), serviceId: r.serviceId, description: r.serviceName, quantity: 1, unitPrice: 0, appointment: true }, ...all.filter((l) => !l.appointment)]);
  };

  const clearAppointment = () => {
    setAppointment(null);
    setLines((all) => all.filter((l) => !l.appointment));
  };

  const changeQuantity = (key: string, delta: number) =>
    setLines((all) => all.flatMap((l) => (l.key !== key ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: Math.min(l.quantity + delta, 999) }])));

  const removeLine = (line: Line) => (line.appointment ? clearAppointment() : setLines((all) => all.filter((l) => l.key !== line.key)));

  const reset = () => {
    setContact(null);
    setAppointment(null);
    setLines([]);
    setDiscountChoice("0");
    setDiscountAmount("");
    setNotes("");
    setPay(INITIAL_PAY);
    setIdempotencyKey(uid());
    setError(null);
    setSale(null);
    setTicketOpen(false);
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const payments = netPayments(totals.total, resolved.payments);
      const result = await createCharge({
        organizationId,
        contactId: contact?.id ?? null,
        appointmentId: appointment?.appointmentId ?? null,
        items: lines.map((l, i) => ({ serviceId: l.serviceId, description: l.description, quantity: l.quantity, unitPrice: priced[i].unitPrice })),
        discount: totals.discount,
        payments,
        notes,
        idempotencyKey,
      });
      if (result.ok) {
        setTicketOpen(false);
        setSale({ ...result.data, change: resolved.change, methods: [...new Set(payments.map((p) => p.method))] });
        notify(result.message ?? "Cobro registrado.");
        router.refresh();
      } else {
        // El servidor no creó nada: una clave nueva evita reutilizarla con otros datos.
        setIdempotencyKey(uid());
        setError(result.error);
      }
    });

  const ticket = (
    <Ticket
      lines={lines}
      priced={priced}
      catalogHas={(id) => catalog.has(id)}
      totals={totals}
      discountOk={discountOk}
      notes={notes}
      onNotes={setNotes}
      onQuantity={changeQuantity}
      onRemove={removeLine}
      onClear={reset}
    >
      <PaymentPicker total={totals.total} value={pay} onChange={setPay} resolved={resolved} />
      {error ? <Alert tone="error">{error}</Alert> : null}
    </Ticket>
  );

  const payButton = (
    <Button className="w-full" disabled={!ready} pending={pending} onClick={submit}>
      Cobrar {formatMoney(totals.total)} {PAY_VERB[pay.mode]}
    </Button>
  );

  return (
    <div className="grid items-start gap-6 pb-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      {/* ---------------- Catálogo ---------------- */}
      <section aria-label="Catálogo" className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-4">
          <ShoppingCart className="size-6 text-brand-700" aria-hidden />
          <h2 className="flex-1 text-xl font-semibold tracking-tight">Nueva venta</h2>
          <span className="rounded-lg bg-sunken px-3 py-1.5 text-sm font-medium">Hoy</span>
          <span className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 text-sm">
            <CalendarClock className="size-4 text-brand-700" aria-hidden />
            {dateLabel}
          </span>
          <p className="w-full text-xs text-muted">{sessionLabel}</p>
        </div>

        <div className="grid gap-4 border-y border-line bg-sunken/60 px-5 py-4 sm:grid-cols-2">
          <div className="min-w-0">
            {appointment ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <UserRound className="size-4" aria-hidden />
                  Paciente
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{appointment.contactName}</span>
                    <span className="text-muted"> · cita de las {splitLocal(appointment.localStart).time}</span>
                  </span>
                  <button type="button" onClick={clearAppointment} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Quitar la cita del ticket">
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            ) : (
              <ContactPicker organizationId={organizationId} value={contact} onChange={setContact} optional />
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pos-discount" className="flex items-center gap-1.5 text-sm font-medium">
              <Percent className="size-4" aria-hidden />
              Descuento
            </label>
            <div className="flex gap-2">
              <Select id="pos-discount" value={discountChoice} onChange={(e) => setDiscountChoice(e.target.value)} className="flex-1">
                <option value="0">Sin descuento</option>
                {DISCOUNTS.map((d) => (
                  <option key={d} value={d}>
                    {d}%
                  </option>
                ))}
                <option value="custom">Monto fijo…</option>
              </Select>
              {discountChoice === "custom" ? (
                <Input aria-label="Monto del descuento (MXN)" className="w-28" inputMode="decimal" placeholder="0.00" value={discountAmount} invalid={!discountOk} onChange={(e) => setDiscountAmount(e.target.value)} />
              ) : null}
            </div>
            {!discountOk ? <p className="text-sm font-medium text-red-700">El descuento debe ser menor al subtotal.</p> : null}
          </div>
        </div>

        <div role="tablist" aria-label="Qué cobrar" className="flex gap-6 overflow-x-auto border-b border-line px-5">
          {(
            [
              ["receivables", `Citas por cobrar (${receivables.length})`],
              ["services", "Servicios"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-px border-b-2 py-3 text-sm font-medium whitespace-nowrap ${tab === value ? "border-brand-700 text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="px-5 py-5" role="tabpanel">
          <p className="mb-4 text-center text-xs font-semibold tracking-[0.2em] text-muted uppercase">
            {tab === "receivables" ? "Citas de hoy sin cobro" : "Catálogo de servicios"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tab === "receivables" ? (
              receivables.length === 0 ? (
                <li className="col-span-full rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">No hay citas pendientes de cobro hoy.</li>
              ) : (
                receivables.map((r) => {
                  const selected = appointment?.appointmentId === r.appointmentId;
                  return (
                    <li key={r.appointmentId}>
                      <ProductCard
                        title={r.contactName}
                        price={r.price}
                        meta={
                          <>
                            <Clock className="size-3.5" aria-hidden />
                            {splitLocal(r.localStart).time} · {r.serviceName}
                          </>
                        }
                        footnote={r.professionalName}
                        badge={selected ? "En el ticket" : undefined}
                        disabledReason={r.price <= 0 ? "Sin precio de lista" : !catalog.has(r.serviceId) ? "Servicio inactivo" : undefined}
                        onSelect={() => chooseAppointment(r)}
                        actionLabel={`Cobrar la cita de ${r.contactName}`}
                      />
                    </li>
                  );
                })
              )
            ) : (
              services.map((s) => {
                const qty = inTicket(s.id);
                return (
                  <li key={s.id}>
                    <ProductCard
                      title={s.name}
                      price={s.price}
                      meta={
                        <>
                          <Clock className="size-3.5" aria-hidden />
                          {formatDuration(s.durationMinutes)}
                        </>
                      }
                      badge={qty ? `${qty} en el ticket` : undefined}
                      disabledReason={s.price <= 0 ? "Sin precio de lista" : undefined}
                      onSelect={() => addService(s)}
                      actionLabel={`Agregar ${s.name}`}
                    />
                  </li>
                );
              })
            )}
            <li>
              <button
                type="button"
                onClick={() => setFreeOpen(true)}
                className="flex h-full min-h-36 w-full flex-col justify-between rounded-xl border border-brand-200 bg-brand-50 p-4 text-left transition-colors hover:border-brand-400"
              >
                <span className="flex items-center gap-2 font-medium text-brand-900">
                  <PenLine className="size-4" aria-hidden />
                  Concepto libre
                </span>
                <span className="text-sm text-brand-800">Agregar un cargo que no está en el catálogo</span>
              </button>
            </li>
          </ul>
          {tab === "receivables" && receivables.some((r) => r.price <= 0) ? (
            <div className="mt-4">
              <Alert tone="info">Algunas citas no tienen precio de lista. Fija el precio en Servicios o cóbralas como concepto libre.</Alert>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------- Ticket (escritorio) ---------------- */}
      <aside aria-label="Ticket" className="hidden rounded-2xl border border-line bg-surface lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6rem)] lg:flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">Ticket</h2>
          <span className="text-sm text-muted">{count === 1 ? "1 concepto" : `${count} conceptos`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{ticket}</div>
        <div className="border-t border-line px-5 py-4">{payButton}</div>
      </aside>

      {/* ---------------- Ticket (teléfono y tableta) ---------------- */}
      <div className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 print:hidden md:bottom-4 md:left-[calc(15rem+1rem)] lg:hidden">
        <button
          type="button"
          onClick={() => setTicketOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl bg-brand-700 px-4 py-3 text-left text-white shadow-lg"
          aria-haspopup="dialog"
        >
          <ShoppingCart className="size-5" aria-hidden />
          <span className="flex-1 text-sm font-medium">{count ? `Ver ticket · ${count === 1 ? "1 concepto" : `${count} conceptos`}` : "Ticket vacío"}</span>
          <span className="tabular text-lg font-semibold">{formatMoney(totals.total)}</span>
        </button>
      </div>
      <Dialog open={ticketOpen} onClose={() => setTicketOpen(false)} variant="drawer" size="sm" title="Ticket" footer={payButton}>
        {ticket}
      </Dialog>

      <FreeConceptDialog
        open={freeOpen}
        onClose={() => setFreeOpen(false)}
        onAdd={(line) => {
          setLines((all) => [...all, { key: uid(), serviceId: null, ...line }]);
          setFreeOpen(false);
        }}
      />

      {sale ? <SaleDoneDialog sale={sale} onClose={reset} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProductCard({
  title,
  price,
  meta,
  footnote,
  badge,
  disabledReason,
  onSelect,
  actionLabel,
}: {
  title: string;
  price: number;
  meta: React.ReactNode;
  footnote?: string;
  badge?: string;
  disabledReason?: string;
  onSelect: () => void;
  actionLabel: string;
}) {
  const disabled = Boolean(disabledReason);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`${actionLabel}, ${formatMoney(price)}`}
      className={`relative flex h-full min-h-36 w-full flex-col overflow-hidden rounded-xl border text-left transition-colors ${
        badge ? "border-brand-700 ring-1 ring-brand-700" : "border-line-strong"
      } ${disabled ? "cursor-not-allowed bg-sunken" : "bg-canvas hover:border-brand-400 hover:bg-brand-50/50"}`}
    >
      <div className="flex-1 space-y-2 p-4">
        <p className={`line-clamp-2 font-medium ${disabled ? "text-muted" : "text-ink"}`}>{title}</p>
        <p className={`tabular text-2xl font-semibold ${disabled ? "text-muted" : "text-ink"}`}>{formatMoney(price)}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">{meta}</p>
        {footnote ? <p className="truncate text-xs text-muted">{footnote}</p> : null}
      </div>
      {disabledReason ? (
        <span className="bg-red-100 px-4 py-1.5 text-center text-xs font-medium text-red-800">{disabledReason}</span>
      ) : badge ? (
        <span className="bg-brand-700 px-4 py-1.5 text-center text-xs font-medium text-white">{badge}</span>
      ) : null}
    </button>
  );
}

function Ticket({
  lines,
  priced,
  catalogHas,
  totals,
  discountOk,
  notes,
  onNotes,
  onQuantity,
  onRemove,
  onClear,
  children,
}: {
  children: React.ReactNode;
  lines: Line[];
  priced: { quantity: number; unitPrice: number }[];
  catalogHas: (id: string) => boolean;
  totals: { subtotal: number; discount: number; total: number };
  discountOk: boolean;
  notes: string;
  onNotes: (value: string) => void;
  onQuantity: (key: string, delta: number) => void;
  onRemove: (line: Line) => void;
  onClear: () => void;
}) {
  if (lines.length === 0) {
    return <p className="rounded-lg border border-dashed border-line-strong px-3 py-8 text-center text-sm text-muted">Toca una tarjeta para agregarla al ticket.</p>;
  }
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line">
        {lines.map((l, i) => (
          <li key={l.key} className="py-2.5 first:pt-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{l.description}</p>
                <p className="tabular text-xs text-muted">
                  {formatMoney(priced[i].unitPrice)} c/u{l.appointment ? " · cita" : ""}
                </p>
                {l.serviceId && !catalogHas(l.serviceId) ? <p className="text-xs font-medium text-red-700">Este servicio ya no está activo.</p> : null}
              </div>
              <p className="tabular text-sm font-semibold">{formatMoney(priced[i].unitPrice * l.quantity)}</p>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              {l.appointment ? null : (
                <>
                  <button type="button" className={STEP} aria-label={`Quitar uno de ${l.description}`} onClick={() => onQuantity(l.key, -1)}>
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <span className="tabular w-8 text-center text-sm" aria-label={`Cantidad: ${l.quantity}`}>
                    {l.quantity}
                  </span>
                  <button type="button" className={STEP} aria-label={`Agregar otro de ${l.description}`} onClick={() => onQuantity(l.key, 1)}>
                    <Plus className="size-4" aria-hidden />
                  </button>
                </>
              )}
              <Button variant="ghost" size="sm" className="ml-auto" aria-label={`Quitar ${l.description}`} onClick={() => onRemove(l)} icon={<Trash2 className="size-4" aria-hidden />} />
            </div>
          </li>
        ))}
      </ul>

      <dl className="tabular space-y-0.5 border-t border-line pt-3 text-sm">
        <div className="flex justify-between gap-6">
          <dt className="text-muted">Subtotal</dt>
          <dd>{formatMoney(totals.subtotal)}</dd>
        </div>
        {totals.discount > 0 && discountOk ? (
          <div className="flex justify-between gap-6">
            <dt className="text-muted">Descuento</dt>
            <dd>−{formatMoney(totals.discount)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-6 text-lg font-semibold">
          <dt>Total</dt>
          <dd>{formatMoney(Math.max(totals.total, 0))}</dd>
        </div>
      </dl>

      {children}

      <label className="block space-y-1.5 text-sm font-medium">
        Nota (opcional)
        <Input maxLength={300} value={notes} onChange={(e) => onNotes(e.target.value)} />
      </label>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Vaciar ticket
      </Button>
    </div>
  );
}

function FreeConceptDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (line: { description: string; quantity: number; unitPrice: number }) => void }) {
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const value = parseMoney(price);
  const qty = /^\d+$/.test(quantity) ? Number(quantity) : 0;
  const ok = description.trim().length >= 2 && value !== null && value > 0 && qty >= 1 && qty <= 999;

  const submit = () => {
    if (!ok) return;
    onAdd({ description: description.trim(), quantity: qty, unitPrice: value! });
    setDescription("");
    setPrice("");
    setQuantity("1");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Concepto libre"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!ok} onClick={submit}>
            Agregar al ticket
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField label="Descripción" required maxLength={160} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Precio (MXN)"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={price !== "" && value === null ? "Escribe un importe válido." : undefined}
          />
          <TextField label="Cantidad" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
