import { and, asc, eq } from "drizzle-orm";
import { clientContacts, messages, orders } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { DraftGoal } from "@/ai/functions/draft-message";
import type { ExtractedOrder } from "@/domain/email-rules";
import { HttpError } from "../http";
import { emailThread } from "./gateway";
import { movingOrdersOf, prepareReplyDraft } from "./process";

async function loadMessage(db: Executor, sandboxId: string, id: string) {
  const [m] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, id), eq(messages.party, "client")));
  if (!m) throw new HttpError(404, "Nie ma takiej wiadomości.");
  return m;
}

type SentListener = (db: Executor, info: { sandboxId: string; message: typeof messages.$inferSelect; simNow: Date }) => Promise<void>;
const sentListeners: SentListener[] = [];
/** The Sales module marks a quote "offer sent" when its offer draft goes out. */
export function onDraftSent(listener: SentListener) {
  sentListeners.push(listener);
}

type BeforeSendCheck = (db: Executor, info: { sandboxId: string; message: typeof messages.$inferSelect; edit: { subject: string; body: string } }) => Promise<void>;
const beforeSendChecks: BeforeSendCheck[] = [];
/** A module can stop a draft from going out (throw an HttpError), e.g. a shipment update naming the agent. */
export function onBeforeDraftSend(check: BeforeSendCheck) {
  beforeSendChecks.push(check);
}

/** "Sends" a draft: in the demo it is only marked as sent — no e-mail leaves the app. */
export async function sendDraft(db: Executor, sandboxId: string, draftId: string, edit: { subject: string; body: string }, simNow: Date) {
  const m = await loadMessage(db, sandboxId, draftId);
  if (m.state !== "draft") throw new HttpError(409, "Ta wiadomość została już wysłana.");
  for (const check of beforeSendChecks) await check(db, { sandboxId, message: m, edit });
  await db
    .update(messages)
    .set({ state: "sent", sentBy: "dispatcher", subject: edit.subject.slice(0, 200), body: edit.body.slice(0, 4000), atSim: simNow })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, draftId)));
  for (const listener of sentListeners) await listener(db, { sandboxId, message: m, simNow });
}

export async function discardDraft(db: Executor, sandboxId: string, draftId: string) {
  const m = await loadMessage(db, sandboxId, draftId);
  if (m.state !== "draft") throw new HttpError(409, "Wysłanej wiadomości nie można odrzucić.");
  await db.delete(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, draftId)));
}

const GOAL_FOR: Record<string, DraftGoal> = {
  zapytanie_o_status: "status_dla_klienta",
  zamowienie_transportu: "potwierdzenie_zlecenia",
  reklamacja: "odpowiedz_klientowi",
  zapytanie_ofertowe: "odpowiedz_klientowi",
  inne: "odpowiedz_klientowi",
};

/** "Szkic odpowiedzi (AI)" on demand; reuses an open draft in the thread. */
export async function requestReplyDraft(db: Db, sandboxId: string, rootId: string, simNow: Date) {
  const root = await loadMessage(db, sandboxId, rootId);
  const thread = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, root.threadKey))).orderBy(asc(messages.atSim));
  const open = thread.find((m) => m.state === "draft");
  if (open) return open.id;
  if (root.direction !== "in" || !root.clientContactId) throw new HttpError(409, "Do tej wiadomości nie da się przygotować odpowiedzi.");
  const extracted = root.aiExtracted as (ExtractedOrder & { problems?: string[] }) | null;
  const missing = extracted?.problems?.length ? extracted.problems : undefined;
  const goal: DraftGoal = missing && !root.orderId ? "prosba_o_brakujace_dane" : (GOAL_FOR[root.aiCategory ?? "inne"] ?? "odpowiedz_klientowi");
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, root.clientContactId)));
  const orderIds = root.orderId ? [root.orderId] : goal === "status_dla_klienta" && contact ? await movingOrdersOf(db, sandboxId, contact.clientId) : [];
  const needsOrder = goal === "status_dla_klienta" || goal === "potwierdzenie_zlecenia";
  return prepareReplyDraft(db, sandboxId, {
    goal: needsOrder && orderIds.length === 0 ? "odpowiedz_klientowi" : goal,
    orderIds,
    threadKey: root.threadKey,
    contactId: root.clientContactId,
    orderId: root.orderId,
    email: { subject: root.subject ?? "", body: root.body },
    missing,
    simNow,
    kind: "draft_reply",
  });
}

/** Alert action "Powiadom klienta": a delay notice for the order's client, as a new draft thread. */
export async function composeDelayNotice(db: Db, sandboxId: string, orderId: string, simNow: Date) {
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  const existing = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.orderId, orderId), eq(messages.kind, "draft_delay"), eq(messages.state, "draft")));
  if (existing[0]) return existing[0].id;
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.clientId, order.clientId))).orderBy(asc(clientContacts.id));
  if (!contact) throw new HttpError(409, "Klient nie ma osoby kontaktowej.");
  const placeholder = crypto.randomUUID();
  const id = await prepareReplyDraft(db, sandboxId, {
    goal: "opoznienie_dla_klienta",
    threadKey: emailThread(placeholder),
    contactId: contact.id,
    orderId,
    email: null,
    simNow,
    kind: "draft_delay",
  });
  // A composed thread is keyed by its first message, like an inbound one.
  await db.update(messages).set({ threadKey: emailThread(id) }).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, id)));
  return id;
}
