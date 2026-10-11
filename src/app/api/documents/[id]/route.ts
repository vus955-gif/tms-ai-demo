import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { assignDocument, closeOrderFromDocument, rejectDocument } from "@/server/documents/cmr";
import { readJson, withSandbox } from "@/server/http";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("assign"), orderId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("reject") }),
]);

/** Dispatcher decision on a CMR: close the order, assign the document by hand, or reject it. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      if (input.action === "close") await closeOrderFromDocument(c.db, c.sandbox.id, id, simNow);
      else if (input.action === "assign") await assignDocument(c.db, c.sandbox.id, id, input.orderId, simNow);
      else await rejectDocument(c.db, c.sandbox.id, id, simNow);
      return { ok: true };
    });
  });
}
