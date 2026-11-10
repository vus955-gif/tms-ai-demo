import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drivers, messages } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { DriverLanguage } from "@/domain/driver-language";

/**
 * MessageGateway, demo implementation: messages are only stored. Production
 * would hand outbound SMS to an SMS/MMS gateway and receive inbound ones by
 * webhook (see the deployment document).
 */

export const driverThread = (driverId: string) => `driver:${driverId}`;

export async function driverLanguage(db: Executor, sandboxId: string, driverId: string): Promise<DriverLanguage> {
  const [driver] = await db.select({ language: drivers.language }).from(drivers).where(and(eq(drivers.sandboxId, sandboxId), eq(drivers.id, driverId)));
  return driver?.language ?? "pl";
}

type Outbound = { driverId: string; kind: string; orderId?: string | null; sentBy: "dispatcher" | "system"; atSim: Date } & (
  | { body: string; translation?: string | null }
  // A system SMS built from a template: sent in the driver's language, with the Polish text kept for the dispatcher.
  | { localized: (lang: DriverLanguage) => string }
);

export async function sendToDriver(db: Executor, sandboxId: string, msg: Outbound): Promise<string> {
  const id = randomUUID();
  let body: string;
  let translation: string | null;
  if ("localized" in msg) {
    const lang = await driverLanguage(db, sandboxId, msg.driverId);
    body = msg.localized(lang);
    translation = lang === "pl" ? null : msg.localized("pl");
  } else {
    body = msg.body;
    translation = msg.translation ?? null;
  }
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "sms",
    direction: "out",
    party: "driver",
    driverId: msg.driverId,
    threadKey: driverThread(msg.driverId),
    body,
    translation,
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
