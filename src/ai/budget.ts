import { and, eq, gt, ne, sql } from "drizzle-orm";
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
async function callsFromAddress(db: Executor, ipHash: string, realNow: Date, exceptSandboxId?: string): Promise<number> {
  const [row] = await db
    .select({ calls: sql<number>`coalesce(sum(${sandboxes.aiCallsInWindow}), 0)` })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.ipHash, ipHash),
        gt(sandboxes.aiWindowStart, new Date(realNow.getTime() - HOUR)),
        exceptSandboxId ? ne(sandboxes.id, exceptSandboxId) : undefined,
      ),
    );
  return Number(row?.calls ?? 0);
}

/**
 * Claims one API call in the world's hourly window right before it is made, and says whether it fits.
 * Checking first and counting only after the answer let every parallel request through. The claim is one
 * atomic increment, so requests from the same world sent at once get consecutive numbers and only those
 * that fit under the limit go on; a claim that does not fit is given back.
 */
export async function claimCall(db: Executor, sandboxId: string, realNow: Date): Promise<BudgetBlock | null> {
  const windowStart = new Date(realNow.getTime() - HOUR);
  const windowClosed = sql`${sandboxes.aiWindowStart} is null or ${sandboxes.aiWindowStart} <= ${windowStart}`;
  const [claimed] = await db
    .update(sandboxes)
    .set({
      aiWindowStart: sql`case when ${windowClosed} then ${realNow} else ${sandboxes.aiWindowStart} end`,
      aiCallsInWindow: sql`case when ${windowClosed} then 1 else ${sandboxes.aiCallsInWindow} + 1 end`,
    })
    .where(eq(sandboxes.id, sandboxId))
    .returning({ ipHash: sandboxes.ipHash, calls: sandboxes.aiCallsInWindow });
  // The world is gone (reset or cleaned up mid-request): nothing to count the call against, so no call.
  if (!claimed) return "sandbox_limit";
  const others = await callsFromAddress(db, claimed.ipHash, realNow, sandboxId);
  if (others + claimed.calls <= config.aiCallsPerIpPerHour) return null;
  await db
    .update(sandboxes)
    .set({ aiCallsInWindow: sql`greatest(${sandboxes.aiCallsInWindow} - 1, 0)` })
    .where(eq(sandboxes.id, sandboxId));
  return "sandbox_limit";
}

/** Adds the cost of one answered API call to the global daily budget. */
export async function recordSpend(db: Executor, realNow: Date, cost: number) {
  await db
    .insert(aiBudgetDaily)
    .values({ day: utcDay(realNow), costUsd: cost, calls: 1 })
    .onConflictDoUpdate({
      target: aiBudgetDaily.day,
      set: { costUsd: sql`${aiBudgetDaily.costUsd} + ${cost}`, calls: sql`${aiBudgetDaily.calls} + 1` },
    });
}
