import { and, eq, inArray, notInArray } from "drizzle-orm";
import { clientContacts, clients, messages, orders, points } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { draftMessage, templateDraft, type DraftGoal } from "@/ai/functions/draft-message";
import { triageClientEmail, type ClientEmailTriage, type TriageContext } from "@/ai/functions/triage-client-email";
import { CLIENT_STATUS, type ClientView } from "@/domain/client-view";
import type { ExtractedOrder } from "@/domain/email-rules";
import { openAlert } from "../alerts/repository";
import { createOrder, NewOrderSchema } from "../orders/create";
import { routeLabelFor } from "./labels";
import { buildClientView, draftLeaksDriverData } from "./client-facts";
import { saveDraft } from "./gateway";

const FINISHED = ["ZAMKNIETE", "ANULOWANE"] as const;

type InquiryListener = (db: Db, info: { sandboxId: string; messageId: string; simNow: Date; skipAi?: boolean }) => Promise<void>;
const inquiryListeners: InquiryListener[] = [];
/** The Sales module turns quote requests ("zapytanie ofertowe") into quotes. */
export function onQuoteInquiry(listener: InquiryListener) {
  inquiryListeners.push(listener);
}

export async function movingOrdersOf(db: Executor, sandboxId: string, clientId: string): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), eq(orders.clientId, clientId), inArray(orders.status, ["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"])));
  return rows.map((r) => r.id).sort();
}

async function triageContext(db: Executor, sandboxId: string, clientId: string): Promise<TriageContext & { clientName: string }> {
  const [client] = await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, clientId)));
  const own = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, clientId)));
  const active = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), eq(orders.clientId, clientId), notInArray(orders.status, [...FINISHED])));
  return {
    clientName: client?.name ?? "",
    points: own.map((p) => ({ id: p.id, name: p.name, city: p.city, address: p.address })),
    orders: await Promise.all(
      active.map(async (o) => ({ id: o.id, number: o.number, references: o.references, route: await routeLabelFor(db, sandboxId, o), status: CLIENT_STATUS[o.status] })),
    ),
  };
}

/** Turns a complete extraction into a SZKIC order; returns problems when it cannot. */
async function createDraftOrder(db: Executor, sandboxId: string, clientId: string, e: ExtractedOrder, messageId: string, simNow: Date, source: "ai" | "fallback") {
  const fromNulls = [
    [e.pickup_point_id, "punkt załadunku"],
    [e.delivery_point_id, "punkt rozładunku"],
    [e.pickup_from && e.pickup_to, "okno załadunku"],
    [e.delivery_from && e.delivery_to, "okno rozładunku"],
    [e.pallets, "liczba palet"],
    [e.kg, "waga"],
  ]
    .filter(([v]) => v === null || v === undefined || v === "")
    .map(([, label]) => label as string);
  const missing = [...new Set([...e.missing_fields, ...fromNulls])];
  if (missing.length > 0) return { orderId: null, problems: missing };
  const parsed = NewOrderSchema.safeParse({
    clientId,
    pickupPointId: e.pickup_point_id,
    deliveryPointId: e.delivery_point_id,
    pickupFrom: e.pickup_from,
    pickupTo: e.pickup_to,
    deliveryFrom: e.delivery_from,
    deliveryTo: e.delivery_to,
    cargoPallets: e.pallets,
    cargoKg: e.kg,
    bodyRequired: e.reefer ? "chlodnia" : null,
    adrRequired: e.adr,
    references: e.references,
    notes: e.notes ?? "",
  });
  // Our schema messages are Polish; anything else (library defaults) becomes a neutral label.
  if (!parsed.success) return { orderId: null, problems: parsed.error.issues.map((i) => (/[ąćęłńóśźż]|okno|punkt|palet|wag/i.test(i.message) ? i.message : "niespójne dane zlecenia")) };
  const created = await createOrder(db, sandboxId, parsed.data, {
    simNow,
    source: "email",
    status: "SZKIC",
    sourceMessageId: messageId,
    actor: source === "ai" ? "ai" : "system",
    reason: source === "ai" ? "Szkic przygotowany przez AI z maila klienta" : "Szkic z maila klienta (reguły, bez AI)",
  });
  return { orderId: created.id, problems: [] as string[] };
}

/**
 * Prepares a reply draft for a client thread. Facts come only from clientView;
 * an AI draft that mentions a driver is replaced by the template (spec §7.8).
 */
export async function prepareReplyDraft(
  db: Db,
  sandboxId: string,
  opts: {
    goal: DraftGoal;
    threadKey: string;
    contactId: string;
    orderId: string | null;
    /** Several orders for one reply (a status question when the client has more trucks on the road). */
    orderIds?: string[];
    email: { subject: string; body: string } | null;
    missing?: string[];
    simNow: Date;
    skipAi?: boolean;
    kind: string;
  },
) {
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, opts.contactId)));
  const [client] = contact ? await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, contact.clientId))) : [];
  const ids = opts.orderIds ?? (opts.orderId ? [opts.orderId] : []);
  const views = (await Promise.all(ids.map((id) => buildClientView(db, sandboxId, id)))).filter((v): v is ClientView => v !== null);
  const outcome = await draftMessage({
    db,
    sandboxId,
    simNow: opts.simNow,
    goal: opts.goal,
    views,
    clientName: client?.name ?? "",
    contactName: contact?.name ?? null,
    email: opts.email,
    missing: opts.missing,
    inputRef: views.length ? `Szkic do klienta: ${views.map((v) => v.number).join(", ")}` : `Szkic do klienta: ${opts.email?.subject.slice(0, 50) ?? ""}`,
    skipAi: opts.skipAi,
  });
  let draft = outcome.value;
  let by: "ai" | "rules" = outcome.source === "ai" ? "ai" : "rules";
  if (by === "ai" && (await draftLeaksDriverData(db, sandboxId, `${draft.subject}\n${draft.body}`))) {
    draft = templateDraft(opts.goal, { views, subject: opts.email?.subject, missing: opts.missing });
    by = "rules";
  }
  return saveDraft(db, sandboxId, { threadKey: opts.threadKey, contactId: opts.contactId, subject: draft.subject, body: draft.body, atSim: opts.simNow, orderId: opts.orderId, kind: opts.kind, classifiedBy: by });
}

/**
 * Triage of one inbound client e-mail and its effects: order → SZKIC draft;
 * status question → reply draft from clientView; complaint → high priority +
 * alert; quote request → labelled for the (future) Sales module.
 */
export async function processClientEmail(db: Db, sandboxId: string, messageId: string, opts: { simNow: Date; skipAi?: boolean }): Promise<ClientEmailTriage> {
  const [msg] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  if (!msg || !msg.clientContactId) throw new Error(`E-mail ${messageId} not found`);
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, msg.clientContactId)));
  const ctx = await triageContext(db, sandboxId, contact.clientId);
  const { value: t, source } = await triageClientEmail({ db, sandboxId, simNow: opts.simNow, subject: msg.subject ?? "", body: msg.body, context: ctx, skipAi: opts.skipAi });

  let orderId = t.related_order_id;
  let extracted: (ExtractedOrder & { problems?: string[] }) | null = t.extracted_order;
  if (t.category === "zamowienie_transportu" && t.extracted_order) {
    const draft = await createDraftOrder(db, sandboxId, contact.clientId, t.extracted_order, messageId, msg.atSim, source);
    orderId = draft.orderId;
    extracted = { ...t.extracted_order, problems: draft.problems };
  }
  // A status question without an order number: one truck on the road is the one; several go into one reply.
  let statusOrders: string[] = orderId ? [orderId] : [];
  if (t.category === "zapytanie_o_status" && !orderId) {
    statusOrders = await movingOrdersOf(db, sandboxId, contact.clientId);
    if (statusOrders.length === 1) orderId = statusOrders[0];
  }

  await db
    .update(messages)
    .set({
      aiCategory: t.category,
      aiPriority: t.priority,
      aiSummary: t.summary,
      aiExtracted: extracted as Record<string, unknown> | null,
      classifiedBy: source === "ai" ? "ai" : "rules",
      orderId,
    })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));

  const email = { subject: msg.subject ?? "", body: msg.body };
  if (t.category === "zapytanie_o_status" && statusOrders.length > 0) {
    await prepareReplyDraft(db, sandboxId, {
      goal: "status_dla_klienta",
      threadKey: msg.threadKey,
      contactId: contact.id,
      orderId,
      orderIds: statusOrders,
      email,
      simNow: msg.atSim,
      skipAi: opts.skipAi,
      kind: "draft_status",
    });
  }
  if (t.category === "zamowienie_transportu" && !orderId && extracted?.problems?.length) {
    await prepareReplyDraft(db, sandboxId, {
      goal: "prosba_o_brakujace_dane",
      threadKey: msg.threadKey,
      contactId: contact.id,
      orderId: null,
      email,
      missing: extracted.problems,
      simNow: msg.atSim,
      skipAi: opts.skipAi,
      kind: "draft_missing",
    });
  }
  if (t.category === "zapytanie_ofertowe") {
    for (const listener of inquiryListeners) await listener(db, { sandboxId, messageId, simNow: msg.atSim, skipAi: opts.skipAi });
  }
  if (t.category === "reklamacja") {
    await openAlert(
      db,
      sandboxId,
      {
        kind: "complaint",
        severity: "warning",
        dedupeKey: `complaint:${messageId}`,
        title: `Reklamacja: ${ctx.clientName}`,
        body: `${t.summary} Mail od ${contact.name} czeka w Skrzynce.`,
        actions: ["otworz_mail"],
        facts: {},
        orderId,
        messageId,
      },
      msg.atSim,
    );
  }
  return t;
}
