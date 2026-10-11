import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { approveDraftOrder, rejectDraftOrder } from "@/server/orders/drafts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), values: z.unknown().optional() }),
  z.object({ action: z.literal("reject") }),
]);

/** Approve an e-mail draft order (optionally corrected) or reject it. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/draft">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      if (input.action === "reject") {
        await rejectDraftOrder(c.db, c.sandbox.id, id, simNow);
        return { ok: true };
      }
      return approveDraftOrder(c.db, c.sandbox.id, id, input.values ?? null, simNow);
    });
  });
}
