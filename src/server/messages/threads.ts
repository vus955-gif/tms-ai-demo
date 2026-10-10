import { and, asc, eq, isNull } from "drizzle-orm";
import { drivers, messages, type MessagePriority } from "@/db/schema";
import type { Executor } from "@/db/types";
import { HttpError } from "../http";
import { loadFleet } from "../monitoring/fleet-data";
import { currentOrderOf, orderSummary, type OrderSummary } from "../monitoring/views";
import { driverThread } from "./gateway";

export type ThreadSummary = {
  driverId: string;
  driverName: string;
  plates: string;
  lastBody: string | null;
  lastAt: string | null;
  lastDirection: "in" | "out" | null;
  unread: number;
  priority: MessagePriority | null;
  category: string | null;
};

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  atSim: string;
  sentBy: string;
  kind: string | null;
  channel: string;
  attachments: { sampleId?: string; notStored?: boolean; name?: string }[];
  aiCategory: string | null;
  aiSubtype: string | null;
  aiPriority: MessagePriority | null;
  aiSummary: string | null;
  aiSuggestedReplies: string[];
  classifiedBy: "ai" | "rules" | null;
  readAtSim: string | null;
};

export type ThreadDetail = {
  driverId: string;
  driverName: string;
  phone: string;
  plates: string;
  trailerPlates: string | null;
  order: OrderSummary | null;
  messages: ThreadMessage[];
};

const PRIORITY_RANK: Record<MessagePriority, number> = { wysoki: 0, normalny: 1, niski: 2 };

export async function listThreads(db: Executor, sandboxId: string): Promise<ThreadSummary[]> {
  const [driverRows, rows, fleet] = await Promise.all([
    db.select().from(drivers).where(eq(drivers.sandboxId, sandboxId)),
    db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.party, "driver"))).orderBy(asc(messages.atSim)),
    loadFleet(db, sandboxId),
  ]);
  return driverRows
    .map((d) => {
      const own = rows.filter((m) => m.driverId === d.id);
      const last = own[own.length - 1];
      const unread = own.filter((m) => m.direction === "in" && !m.readAtSim);
      const top = unread.map((m) => m.aiPriority).filter((p): p is MessagePriority => Boolean(p)).sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0] ?? null;
      const lastIn = [...own].reverse().find((m) => m.direction === "in");
      return {
        driverId: d.id,
        driverName: `${d.firstName} ${d.lastName}`,
        plates: fleet.vehicles.find((v) => v.id === d.vehicleId)?.plates ?? "",
        lastBody: last?.body ?? null,
        lastAt: last?.atSim.toISOString() ?? null,
        lastDirection: last?.direction ?? null,
        unread: unread.length,
        priority: top,
        category: lastIn?.aiCategory ?? null,
      };
    })
    .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.driverName.localeCompare(b.driverName, "pl"));
}

export async function threadDetail(db: Executor, sandboxId: string, driverId: string): Promise<ThreadDetail> {
  const fleet = await loadFleet(db, sandboxId);
  const driver = fleet.drivers.get(driverId);
  if (!driver) throw new HttpError(404, "Nie ma takiego kierowcy.");
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, driverThread(driverId))))
    .orderBy(asc(messages.atSim));
  const vehicle = fleet.vehicles.find((v) => v.id === driver.vehicleId);
  const order = vehicle ? currentOrderOf(fleet, vehicle.id) : undefined;
  return {
    driverId,
    driverName: `${driver.firstName} ${driver.lastName}`,
    phone: driver.phone,
    plates: vehicle?.plates ?? "",
    trailerPlates: vehicle ? (fleet.trailerByVehicle.get(vehicle.id)?.plates ?? null) : null,
    order: order ? orderSummary(fleet, order) : null,
    messages: rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      atSim: m.atSim.toISOString(),
      sentBy: m.sentBy,
      kind: m.kind,
      channel: m.channel,
      attachments: m.attachments,
      aiCategory: m.aiCategory,
      aiSubtype: m.aiSubtype,
      aiPriority: m.aiPriority,
      aiSummary: m.aiSummary,
      aiSuggestedReplies: m.aiSuggestedReplies,
      classifiedBy: m.classifiedBy,
      readAtSim: m.readAtSim?.toISOString() ?? null,
    })),
  };
}

export async function markThreadRead(db: Executor, sandboxId: string, driverId: string, atSim: Date) {
  await db
    .update(messages)
    .set({ readAtSim: atSim })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, driverThread(driverId)), eq(messages.direction, "in"), isNull(messages.readAtSim)));
}

export async function unreadDriverMessages(db: Executor, sandboxId: string): Promise<number> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.party, "driver"), eq(messages.direction, "in"), isNull(messages.readAtSim)));
  return rows.length;
}
