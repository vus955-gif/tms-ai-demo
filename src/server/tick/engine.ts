import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, lte, sql } from "drizzle-orm";
import { sandboxes, scheduledEvents } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { simNow as clockNow, type ClockState, type Speed } from "@/simulation/clock";
import { createRng, seedFromString } from "@/simulation/random";
import { config } from "../config";
import { getSandbox, type SandboxRow } from "../sandbox/repository";
import { getEventHandler, getTickPhases, type NewScheduledEvent, type TickContext } from "./registry";

/** Items older than this (simulation time) count as "nobody watched it happen". */
const STALE_AFTER_MS = 15 * 60_000;

export class TickConflict extends Error {}

export type TickResult = {
  sandbox: SandboxRow;
  simNow: Date;
  processed: number;
  remaining: number;
  conflict: boolean;
};

export function clockOf(sandbox: SandboxRow): ClockState {
  return {
    simOrigin: sandbox.simOrigin,
    simElapsedMs: sandbox.simElapsedMs,
    running: sandbox.running,
    speed: sandbox.speed as Speed,
    realResumedAt: sandbox.realResumedAt,
  };
}

export async function scheduleEvent(db: Executor, sandboxId: string, event: NewScheduledEvent) {
  await db.insert(scheduledEvents).values({
    sandboxId,
    id: randomUUID(),
    dueSim: event.dueSim,
    type: event.type,
    payload: event.payload ?? {},
  });
}

/**
 * Advances one world to "now": processes due events in time order (at most
 * `maxEventsPerTick`), runs the tick phases and commits only if no other tick
 * committed in the meantime (optimistic version check).
 */
export async function runTick(db: Db, sandboxId: string, realNow: Date): Promise<TickResult> {
  const loaded = await getSandbox(db, sandboxId);
  if (!loaded) throw new Error(`Sandbox ${sandboxId} not found`);
  const target = new Date(Math.max(clockNow(clockOf(loaded), realNow).getTime(), loaded.lastTickSim.getTime()));
  const afterCommit: ((db: Db) => Promise<void>)[] = [];

  try {
    const outcome = await db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.sandboxId, sandboxId),
            isNull(scheduledEvents.processedAtSim),
            lte(scheduledEvents.dueSim, target),
          ),
        )
        .orderBy(asc(scheduledEvents.dueSim), asc(scheduledEvents.id))
        .limit(config.maxEventsPerTick + 1);
      const batch = due.slice(0, config.maxEventsPerTick);
      let remaining = 0;
      if (due.length > batch.length) {
        const [{ value }] = await tx
          .select({ value: count() })
          .from(scheduledEvents)
          .where(
            and(
              eq(scheduledEvents.sandboxId, sandboxId),
              isNull(scheduledEvents.processedAtSim),
              lte(scheduledEvents.dueSim, target),
            ),
          );
        remaining = value - batch.length;
      }
      // When capped, stop the clock at the last processed event so phases never run ahead of history.
      const reached = remaining > 0 ? batch[batch.length - 1].dueSim : target;

      const ctx: TickContext = {
        tx,
        sandbox: loaded,
        simNow: reached,
        previousSim: loaded.lastTickSim,
        realNow,
        rng: createRng(loaded.seed ^ seedFromString(reached.toISOString())),
        isStale: (at) => reached.getTime() - at.getTime() > STALE_AFTER_MS,
        schedule: (event) => scheduleEvent(tx, sandboxId, event),
        afterCommit: (task) => {
          afterCommit.push(task);
        },
      };

      for (const event of batch) {
        const handler = getEventHandler(event.type);
        if (handler) await handler({ ...ctx, simNow: event.dueSim }, event);
        else console.warn(`[tick] no handler for event type "${event.type}"`);
        await tx
          .update(scheduledEvents)
          .set({ processedAtSim: event.dueSim })
          .where(and(eq(scheduledEvents.sandboxId, sandboxId), eq(scheduledEvents.id, event.id)));
      }

      for (const phase of getTickPhases()) await phase.run(ctx);

      const updated = await tx
        .update(sandboxes)
        .set({ lastTickSim: reached, version: sql`${sandboxes.version} + 1` })
        .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.version, loaded.version)))
        .returning();
      if (updated.length === 0) throw new TickConflict();
      return { sandbox: updated[0], simNow: reached, processed: batch.length, remaining };
    });

    for (const task of afterCommit) {
      try {
        await task(db);
      } catch (error) {
        console.error("[tick] after-commit task failed", error);
      }
    }
    return { ...outcome, conflict: false };
  } catch (error) {
    if (!(error instanceof TickConflict)) throw error;
    const current = (await getSandbox(db, sandboxId))!;
    return { sandbox: current, simNow: current.lastTickSim, processed: 0, remaining: 0, conflict: true };
  }
}
