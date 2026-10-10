import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { aiLog } from "@/db/schema";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";

export type AiLogEntry = {
  id: string;
  fn: string;
  model: string;
  inputRef: string;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
  reason: string | null;
  error: string | null;
  atSim: string;
  createdReal: string;
  actionTaken: string | null;
  reverted: boolean;
};

/** Latest AI calls of the visitor's world, newest first. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 200);
    const rows = await db
      .select()
      .from(aiLog)
      .where(eq(aiLog.sandboxId, sandbox.id))
      .orderBy(desc(aiLog.createdReal))
      .limit(limit);
    const entries: AiLogEntry[] = rows.map((r) => ({
      id: r.id,
      fn: r.fn,
      model: r.model,
      inputRef: r.inputRef,
      output: r.output,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      fallbackUsed: r.fallbackUsed,
      reason: r.reason,
      error: r.error,
      atSim: r.atSim.toISOString(),
      createdReal: r.createdReal.toISOString(),
      actionTaken: r.actionTaken,
      reverted: r.reverted,
    }));
    return { entries };
  });
}
