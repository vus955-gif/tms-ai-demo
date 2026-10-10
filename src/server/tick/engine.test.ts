import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sandboxes, scheduledEvents } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick, scheduleEvent } from "./engine";
import { registerEventHandler } from "./registry";

const realStart = new Date("2026-10-14T10:00:00Z");
const MIN = 60_000;
const seen: string[] = [];
const staleness: boolean[] = [];

registerEventHandler("test.record", async (ctx, event) => {
  seen.push(String(event.payload.label));
  staleness.push(ctx.isStale(event.dueSim));
});
registerEventHandler("test.collide", async (ctx) => {
  // Simulates another tab committing a tick while this one is running.
  await ctx.tx.update(sandboxes).set({ version: sql`${sandboxes.version} + 1` }).where(eq(sandboxes.id, ctx.sandbox.id));
});
registerEventHandler("test.chain", async (ctx, event) => {
  seen.push("chain");
  await ctx.schedule({ dueSim: new Date(event.dueSim.getTime() + MIN), type: "test.record", payload: { label: "follow-up" } });
});

describe("runTick", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (minutes: number) => new Date(sandbox.simOrigin.getTime() + minutes * MIN);
  /** Real time at which a 10x clock reaches `simMinutes`. */
  const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * MIN) / 10);

  beforeEach(async () => {
    seen.length = 0;
    staleness.length = 0;
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "ip", realNow: realStart });
  });

  it("processes due events in time order and leaves future ones", async () => {
    await scheduleEvent(db, sandbox.id, { dueSim: at(30), type: "test.record", payload: { label: "b" } });
    await scheduleEvent(db, sandbox.id, { dueSim: at(10), type: "test.record", payload: { label: "a" } });
    await scheduleEvent(db, sandbox.id, { dueSim: at(90), type: "test.record", payload: { label: "later" } });
    const result = await runTick(db, sandbox.id, realAt(60));
    expect(seen).toEqual(["a", "b"]);
    expect(result.processed).toBe(2);
    expect(result.simNow).toEqual(at(60));
    expect(result.sandbox.version).toBe(1);
  });

  it("does not process an event twice", async () => {
    await scheduleEvent(db, sandbox.id, { dueSim: at(5), type: "test.record", payload: { label: "once" } });
    await runTick(db, sandbox.id, realAt(10));
    await runTick(db, sandbox.id, realAt(20));
    expect(seen).toEqual(["once"]);
  });

  it("caps a tick at 500 events and reports the rest", async () => {
    const values = Array.from({ length: 503 }, (_, i) => ({
      sandboxId: sandbox.id,
      id: `e-${String(i).padStart(4, "0")}`,
      dueSim: at(1 + i / 100),
      type: "test.record",
      payload: { label: String(i) },
    }));
    await db.insert(scheduledEvents).values(values);
    const first = await runTick(db, sandbox.id, realAt(60));
    expect(first.processed).toBe(500);
    expect(first.remaining).toBe(3);
    // The clock stops at the last processed event, not at "now".
    expect(first.simNow).toEqual(values[499].dueSim);
    const second = await runTick(db, sandbox.id, realAt(60));
    expect(second.processed).toBe(3);
    expect(second.remaining).toBe(0);
    expect(second.simNow).toEqual(at(60));
  });

  it("rolls back everything when another tick committed first", async () => {
    await scheduleEvent(db, sandbox.id, { dueSim: at(5), type: "test.collide" });
    const result = await runTick(db, sandbox.id, realAt(10));
    expect(result.conflict).toBe(true);
    const pending = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.sandboxId, sandbox.id), isNull(scheduledEvents.processedAtSim)));
    expect(pending).toHaveLength(1);
    const [row] = await db.select().from(sandboxes).where(eq(sandboxes.id, sandbox.id));
    expect(row.version).toBe(0);
    expect(row.lastTickSim).toEqual(sandbox.lastTickSim);
  });

  it("flags events older than 15 simulated minutes as stale", async () => {
    await scheduleEvent(db, sandbox.id, { dueSim: at(1), type: "test.record", payload: { label: "old" } });
    await scheduleEvent(db, sandbox.id, { dueSim: at(55), type: "test.record", payload: { label: "fresh" } });
    await runTick(db, sandbox.id, realAt(60));
    expect(staleness).toEqual([true, false]);
  });

  it("lets handlers schedule follow-up events for later ticks", async () => {
    await scheduleEvent(db, sandbox.id, { dueSim: at(5), type: "test.chain" });
    await runTick(db, sandbox.id, realAt(5));
    expect(seen).toEqual(["chain"]);
    await runTick(db, sandbox.id, realAt(10));
    expect(seen).toEqual(["chain", "follow-up"]);
  });

  it("does not move the clock while paused", async () => {
    await db.update(sandboxes).set({ running: false }).where(eq(sandboxes.id, sandbox.id));
    const result = await runTick(db, sandbox.id, realAt(60));
    expect(result.simNow).toEqual(sandbox.simOrigin);
  });
});
