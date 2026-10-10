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
