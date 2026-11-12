import { and, eq, gt, sql } from "drizzle-orm";
import { aiBudgetDaily, sandboxes } from "@/db/schema";
import type { Executor } from "@/db/types";
import { config } from "@/server/config";

const HOUR = 3_600_000;

/** "sandbox_limit" is the hourly limit of one visitor's address (the name stays: it is stored in the AI log). */
export type BudgetBlock = "sandbox_limit" | "daily_budget";

export const utcDay = (realNow: Date) => realNow.toISOString().slice(0, 10);

/** Returns why AI must not be called right now, or null when it may. */
export async function budgetBlock(db: Executor, sandboxId: string, realNow: Date): Promise<BudgetBlock | null> {
  const [daily] = await db.select().from(aiBudgetDaily).where(eq(aiBudgetDaily.day, utcDay(realNow)));
  if (daily && daily.costUsd >= config.aiDailyBudgetUsd) return "daily_budget";
  const [sandbox] = await db.select({ ipHash: sandboxes.ipHash }).from(sandboxes).where(eq(sandboxes.id, sandboxId));
  if (!sandbox) return null;
  if ((await callsFromAddress(db, sandbox.ipHash, realNow)) >= config.aiCallsPerIpPerHour) return "sandbox_limit";
  return null;
}

/**
 * Calls in the open hourly windows of every world of one address. Counting per world alone let a visitor
 * drop the cookie (a new world) or start over (a reset) and get a fresh allowance each time.
 */
async function callsFromAddress(db: Executor, ipHash: string, realNow: Date): Promise<number> {
  const [row] = await db
    .select({ calls: sql<number>`coalesce(sum(${sandboxes.aiCallsInWindow}), 0)` })
    .from(sandboxes)
    .where(and(eq(sandboxes.ipHash, ipHash), gt(sandboxes.aiWindowStart, new Date(realNow.getTime() - HOUR))));
  return Number(row?.calls ?? 0);
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
