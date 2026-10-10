import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { sandboxes } from "@/db/schema";
import type { Db } from "@/db/types";
import { pauseClock, resumeClock, setSpeed } from "@/simulation/clock";
import type { SandboxRow } from "./sandbox/repository";
import { clockOf } from "./tick/engine";

export const ClockActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("speed"),
    speed: z.union([z.literal(1), z.literal(10), z.literal(60)]),
  }),
]);
export type ClockAction = z.infer<typeof ClockActionSchema>;

export async function applyClockAction(db: Db, sandbox: SandboxRow, action: ClockAction, realNow: Date): Promise<SandboxRow> {
  const clock = clockOf(sandbox);
  const next =
    action.action === "pause"
      ? pauseClock(clock, realNow)
      : action.action === "resume"
        ? resumeClock(clock, realNow)
        : setSpeed(clock, action.speed, realNow);
  const [updated] = await db
    .update(sandboxes)
    .set({
      simElapsedMs: Math.round(next.simElapsedMs),
      running: next.running,
      speed: next.speed,
      realResumedAt: next.realResumedAt,
      version: sql`${sandboxes.version} + 1`,
    })
    .where(eq(sandboxes.id, sandbox.id))
    .returning();
  return updated;
}
