import { randomUUID } from "node:crypto";
import { messages } from "@/db/schema";
import type { Executor } from "@/db/types";

/**
 * MessageGateway, demo implementation: messages are only stored. Production
 * would hand outbound SMS to an SMS/MMS gateway and receive inbound ones by
 * webhook (see the deployment document).
 */

export const driverThread = (driverId: string) => `driver:${driverId}`;

export async function sendToDriver(
  db: Executor,
  sandboxId: string,
  msg: { driverId: string; body: string; kind: string; orderId?: string | null; sentBy: "dispatcher" | "system"; atSim: Date },
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "sms",
    direction: "out",
    party: "driver",
    driverId: msg.driverId,
    threadKey: driverThread(msg.driverId),
    body: msg.body,
    state: "sent",
    sentBy: msg.sentBy,
    atSim: msg.atSim,
    readAtSim: msg.atSim,
    orderId: msg.orderId ?? null,
    kind: msg.kind,
  });
  return id;
}

export async function storeDriverInbound(
  db: Executor,
  sandboxId: string,
  msg: {
    driverId: string;
    body: string;
    atSim: Date;
    channel?: "sms" | "mms" | "email";
    attachments?: { sampleId?: string; notStored?: boolean; name?: string }[];
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: msg.channel ?? (msg.attachments?.length ? "mms" : "sms"),
    direction: "in",
    party: "driver",
    driverId: msg.driverId,
    threadKey: driverThread(msg.driverId),
    body: msg.body,
    attachments: msg.attachments ?? [],
    state: "received",
    sentBy: "driver",
    atSim: msg.atSim,
  });
  return id;
}

/**
 * "Zadzwoń": the forwarder called the driver (demo: the number is fictional, nothing is dialled)
 * and leaves a note in the driver's thread, so the next person on shift sees what was agreed.
 */
export async function logCall(db: Executor, sandboxId: string, call: { driverId: string; note: string; atSim: Date }): Promise<string> {
  const id = randomUUID();
  const note = call.note.trim();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "phone",
    direction: "out",
    party: "driver",
    driverId: call.driverId,
    threadKey: driverThread(call.driverId),
    body: note ? `Rozmowa telefoniczna: ${note}` : "Rozmowa telefoniczna (bez notatki).",
    state: "sent",
    sentBy: "dispatcher",
    atSim: call.atSim,
    readAtSim: call.atSim,
    kind: "call_note",
  });
  return id;
}
