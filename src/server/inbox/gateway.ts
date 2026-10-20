import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { messages } from "@/db/schema";
import type { Executor } from "@/db/types";

/**
 * MailGateway, demo implementation: e-mails are only stored and nothing is
 * ever sent. Production would read a mailbox (IMAP / Graph API) and send
 * through SMTP (see the deployment document).
 */

/** One thread per inbound e-mail (or per composed message): `email:<root message id>`. */
export const emailThread = (rootId: string) => `email:${rootId}`;

export async function storeClientInbound(
  db: Executor,
  sandboxId: string,
  mail: { contactId: string; subject: string; body: string; atSim: Date },
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "email",
    direction: "in",
    party: "client",
    clientContactId: mail.contactId,
    threadKey: emailThread(id),
    subject: mail.subject,
    body: mail.body,
    state: "received",
    sentBy: "client",
    atSim: mail.atSim,
  });
  return id;
}

/** Stores an AI- or template-prepared reply as a draft waiting for the dispatcher. */
export async function saveDraft(
  db: Executor,
  sandboxId: string,
  draft: { threadKey: string; contactId: string; subject: string; body: string; atSim: Date; orderId?: string | null; kind: string; classifiedBy: "ai" | "rules" },
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "email",
    direction: "out",
    party: "client",
    clientContactId: draft.contactId,
    threadKey: draft.threadKey,
    subject: draft.subject.slice(0, 200),
    body: draft.body.slice(0, 4000),
    state: "draft",
    sentBy: "system",
    atSim: draft.atSim,
    readAtSim: draft.atSim,
    orderId: draft.orderId ?? null,
    kind: draft.kind,
    classifiedBy: draft.classifiedBy,
  });
  return id;
}

/** An automatic e-mail to a client (e.g. "thank you for your inquiry"); demo: stored only. */
export async function storeClientOutbound(
  db: Executor,
  sandboxId: string,
  mail: { threadKey: string; contactId: string; subject: string; body: string; atSim: Date; kind: string; classifiedBy?: "ai" | "rules" | null },
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "email",
    direction: "out",
    party: "client",
    clientContactId: mail.contactId,
    threadKey: mail.threadKey,
    subject: mail.subject.slice(0, 200),
    body: mail.body.slice(0, 4000),
    state: "sent",
    sentBy: "system",
    atSim: mail.atSim,
    readAtSim: mail.atSim,
    kind: mail.kind,
    classifiedBy: mail.classifiedBy ?? null,
  });
  return id;
}

export async function markEmailThreadRead(db: Executor, sandboxId: string, threadKey: string, atSim: Date) {
  await db
    .update(messages)
    .set({ readAtSim: atSim })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, threadKey), eq(messages.direction, "in"), isNull(messages.readAtSim)));
}

export async function unreadClientEmails(db: Executor, sandboxId: string): Promise<number> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.party, "client"), eq(messages.direction, "in"), isNull(messages.readAtSim)));
  return rows.length;
}
