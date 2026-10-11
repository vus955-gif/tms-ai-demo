import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { revertAiAction } from "@/server/ai-actions";
import { readJson, withSandbox } from "@/server/http";

const Body = z.object({ action: z.literal("revert") });

/** "Cofnij" in the AI log: undo the status change an AI decision made. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ai/log/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      await c.db.transaction((tx) => revertAiAction(tx, c.sandbox.id, id, simNow));
      return { ok: true };
    });
  });
}
