import { and, count, eq, notInArray } from "drizzle-orm";
import { aiStatus, type AiStatus } from "@/ai/status";
import { orders, vehicles } from "@/db/schema";
import type { Executor } from "@/db/types";
import { unreadDriverMessages } from "./messages/threads";
import { monitoringSnapshot, type AlertView, type VehicleView } from "./monitoring/views";
import type { SandboxRow } from "./sandbox/repository";
import type { TickResult } from "./tick/engine";

export type Snapshot = {
  sandboxId: string;
  simNow: string;
  simOrigin: string;
  speed: number;
  running: boolean;
  randomRun: boolean;
  ai: AiStatus;
  counts: { vehicles: number; activeOrders: number };
  tick: { processed: number; remaining: number; conflict: boolean };
  fleet: VehicleView[];
  alerts: AlertView[];
  badges: { komunikator: number; skrzynka: number; dokumenty: number };
  phoneDriverId: string | null;
};

const FINISHED = ["ZAMKNIETE", "ANULOWANE", "SZKIC"] as const;

export async function buildSnapshot(
  db: Executor,
  sandbox: SandboxRow,
  simNow: Date,
  realNow: Date,
  tick: Pick<TickResult, "processed" | "remaining" | "conflict"> = { processed: 0, remaining: 0, conflict: false },
): Promise<Snapshot> {
  const [{ value: vehicleCount }] = await db
    .select({ value: count() })
    .from(vehicles)
    .where(eq(vehicles.sandboxId, sandbox.id));
  const [{ value: activeOrders }] = await db
    .select({ value: count() })
    .from(orders)
    .where(and(eq(orders.sandboxId, sandbox.id), notInArray(orders.status, [...FINISHED])));
  return {
    sandboxId: sandbox.id,
    simNow: simNow.toISOString(),
    simOrigin: sandbox.simOrigin.toISOString(),
    speed: sandbox.speed,
    running: sandbox.running,
    randomRun: sandbox.randomRun,
    ai: await aiStatus(db, sandbox.id, realNow),
    counts: { vehicles: vehicleCount, activeOrders },
    tick: { processed: tick.processed, remaining: tick.remaining, conflict: tick.conflict },
    ...(await monitoringSnapshot(db, sandbox.id)),
    badges: { komunikator: await unreadDriverMessages(db, sandbox.id), skrzynka: 0, dokumenty: 0 },
    phoneDriverId: sandbox.phoneDriverId,
  };
}
