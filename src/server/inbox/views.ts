import { and, asc, eq } from "drizzle-orm";
import { clientContacts, clients, messages, orders, type MessagePriority, type OrderStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { ClientView } from "@/domain/client-view";
import type { ExtractedOrder } from "@/domain/email-rules";
import { STATUS_LABEL } from "@/domain/order-lifecycle";
import { HttpError } from "../http";
import { buildClientView } from "./client-facts";
import { routeLabelFor } from "./labels";

type Extracted = (ExtractedOrder & { problems?: string[] }) | null;

export type InboxItem = {
  rootId: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  clientName: string;
  atSim: string;
  lastAtSim: string;
  unread: boolean;
  composed: boolean;
  category: string | null;
  priority: MessagePriority | null;
  summary: string | null;
  classifiedBy: "ai" | "rules" | null;
  hasDraft: boolean;
  sent: boolean;
  orderNumber: string | null;
  orderStatus: OrderStatus | null;
};

export type InboxMessage = {
  id: string;
  direction: "in" | "out";
  state: "draft" | "sent" | "received";
  subject: string;
  body: string;
  atSim: string;
  sentBy: string;
  kind: string | null;
  classifiedBy: "ai" | "rules" | null;
};

export type DraftOrderView = {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  route: string;
  values: {
    clientId: string;
    pickupPointId: string;
    deliveryPointId: string;
    pickupFrom: string;
    pickupTo: string;
    deliveryFrom: string;
    deliveryTo: string;
    cargoPallets: number;
    cargoKg: number;
    bodyRequired: string | null;
    adrRequired: boolean;
    references: string[];
    notes: string;
  };
};

export type InboxThread = {
  rootId: string;
  contact: { id: string; name: string; email: string };
  client: { id: string; name: string };
  messages: InboxMessage[];
  triage: {
    category: string | null;
    priority: MessagePriority | null;
    summary: string | null;
    classifiedBy: "ai" | "rules" | null;
    extracted: Extracted;
  } | null;
  order: DraftOrderView | null;
  clientView: ClientView | null;
};

type MessageRow = typeof messages.$inferSelect;

export async function listInbox(db: Executor, sandboxId: string): Promise<InboxItem[]> {
  const [rows, contacts, clientRows, orderRows] = await Promise.all([
    // Ties on time: the client's e-mail ("in") before the reply drafted at the same moment.
    db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.party, "client"))).orderBy(asc(messages.atSim), asc(messages.direction), asc(messages.id)),
    db.select().from(clientContacts).where(eq(clientContacts.sandboxId, sandboxId)),
    db.select().from(clients).where(eq(clients.sandboxId, sandboxId)),
    db.select().from(orders).where(eq(orders.sandboxId, sandboxId)),
  ]);
  const threads = new Map<string, MessageRow[]>();
  for (const m of rows) threads.set(m.threadKey, [...(threads.get(m.threadKey) ?? []), m]);
  const items: InboxItem[] = [];
  for (const list of threads.values()) {
    // The thread is keyed by its first message: the inbound e-mail, or the first composed one.
    const root = list.find((m) => m.threadKey === `email:${m.id}`) ?? list[0];
    const last = list[list.length - 1];
    const contact = contacts.find((c) => c.id === root.clientContactId);
    const client = clientRows.find((c) => c.id === contact?.clientId);
    const order = orderRows.find((o) => o.id === (root.orderId ?? list.find((m) => m.orderId)?.orderId));
    items.push({
      rootId: root.id,
      subject: root.subject ?? "(bez tematu)",
      fromName: contact?.name ?? "",
      fromEmail: contact?.email ?? "",
      clientName: client?.name ?? "",
      atSim: root.atSim.toISOString(),
      lastAtSim: last.atSim.toISOString(),
      unread: list.some((m) => m.direction === "in" && !m.readAtSim),
      composed: root.direction === "out",
      category: root.aiCategory,
      priority: root.aiPriority,
      summary: root.aiSummary,
      classifiedBy: root.classifiedBy,
      hasDraft: list.some((m) => m.state === "draft"),
      sent: list.some((m) => m.state === "sent"),
      orderNumber: order?.number ?? null,
      orderStatus: order?.status ?? null,
    });
  }
  const rank = (i: InboxItem) => (i.unread ? 0 : 1) * 10 + (i.priority === "wysoki" ? 0 : i.priority === "normalny" ? 1 : 2);
  return items.sort((a, b) => rank(a) - rank(b) || b.lastAtSim.localeCompare(a.lastAtSim));
}

export async function inboxThread(db: Executor, sandboxId: string, rootId: string): Promise<InboxThread> {
  const [root] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, rootId), eq(messages.party, "client")));
  if (!root || !root.clientContactId) throw new HttpError(404, "Nie ma takiej wiadomości.");
  const list = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, root.threadKey)))
    .orderBy(asc(messages.atSim), asc(messages.direction), asc(messages.id));
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, root.clientContactId)));
  const [client] = await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, contact.clientId)));
  const orderId = root.orderId ?? list.find((m) => m.orderId)?.orderId ?? null;
  const [order] = orderId ? await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId))) : [];
  return {
    rootId,
    contact: { id: contact.id, name: contact.name, email: contact.email },
    client: { id: client.id, name: client.name },
    messages: list.map((m) => ({
      id: m.id,
      direction: m.direction,
      state: m.state,
      subject: m.subject ?? "",
      body: m.body,
      atSim: m.atSim.toISOString(),
      sentBy: m.sentBy,
      kind: m.kind,
      classifiedBy: m.classifiedBy,
    })),
    triage:
      root.direction === "in"
        ? {
            category: root.aiCategory,
            priority: root.aiPriority,
            summary: root.aiSummary,
            classifiedBy: root.classifiedBy,
            extracted: root.aiExtracted as Extracted,
          }
        : null,
    order: order
      ? {
          id: order.id,
          number: order.number,
          status: order.status,
          statusLabel: STATUS_LABEL[order.status],
          route: await routeLabelFor(db, sandboxId, order),
          values: {
            clientId: order.clientId,
            pickupPointId: order.pickupPointId,
            deliveryPointId: order.deliveryPointId,
            pickupFrom: order.pickupFrom.toISOString(),
            pickupTo: order.pickupTo.toISOString(),
            deliveryFrom: order.deliveryFrom.toISOString(),
            deliveryTo: order.deliveryTo.toISOString(),
            cargoPallets: order.cargoPallets,
            cargoKg: order.cargoKg,
            bodyRequired: order.bodyRequired,
            adrRequired: order.adrRequired,
            references: order.references,
            notes: order.notes,
          },
        }
      : null,
    clientView: order ? await buildClientView(db, sandboxId, order.id) : null,
  };
}
