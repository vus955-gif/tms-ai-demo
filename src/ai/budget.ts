import { eq, sql } from "drizzle-orm";
import { aiBudgetDaily, sandboxes } from "@/db/schema";
import type { Executor } from "@/db/types";
import { config } from "@/server/config";

const HOUR = 3_600_000;

export type BudgetBlock = "sandbox_limit" | "daily_budget";

export const utcDay = (realNow: Date) => realNow.toISOString().slice(0, 10);

/** Returns why AI must not be called right now, or null when it may. */
export async function budgetBlock(db: Executor, sandboxId: string, realNow: Date): Promise<BudgetBlock | null> {
  const [daily] = await db.select().from(aiBudgetDaily).where(eq(aiBudgetDaily.day, utcDay(realNow)));
  if (daily && daily.costUsd >= config.aiDailyBudgetUsd) return "daily_budget";
  const [sandbox] = await db
    .select({ start: sandboxes.aiWindowStart, calls: sandboxes.aiCallsInWindow })
    .from(sandboxes)
    .where(eq(sandboxes.id, sandboxId));
  if (!sandbox) return null;
  const windowOpen = sandbox.start && realNow.getTime() - sandbox.start.getTime() < HOUR;
  if (windowOpen && sandbox.calls >= config.aiCallsPerSandboxPerHour) return "sandbox_limit";
  return null;
}

/** Counts one real API call against the world's hourly window and the global daily budget. */
export async function recordSpend(db: Executor, sandboxId: string, realNow: Date, cost: number) {
  await db
    .insert(aiBudgetDaily)
    .values({ day: utcDay(realNow), costUsd: cost, calls: 1 })
    .onConflictDoUpdate({
      target: aiBudgetDaily.day,
      set: { costUsd: sql`${aiBudgetDaily.costUsd} + ${cost}`, calls: sql`${aiBudgetDaily.calls} + 1` },
    });
  const windowStart = new Date(realNow.getTime() - HOUR);
  await db
    .update(sandboxes)
    .set({
      aiWindowStart: sql`case when ${sandboxes.aiWindowStart} is null or ${sandboxes.aiWindowStart} < ${windowStart} then ${realNow} else ${sandboxes.aiWindowStart} end`,
      aiCallsInWindow: sql`case when ${sandboxes.aiWindowStart} is null or ${sandboxes.aiWindowStart} < ${windowStart} then 1 else ${sandboxes.aiCallsInWindow} + 1 end`,
    })
    .where(eq(sandboxes.id, sandboxId));
}
