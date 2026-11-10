import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { deletePoint, PointUpdateSchema, updatePoint } from "@/server/clients/clients";
import { decidePointSuggestion } from "@/server/clients/point-notes";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), values: PointUpdateSchema }),
  z.object({ action: z.literal("delete") }),
  // A note proposed from a driver's message: accepted (optionally reworded) or rejected by the dispatcher.
  z.object({ action: z.literal("suggestion"), suggestionId: z.string().min(1).max(64), decision: z.enum(["accept", "reject"]), text: z.string().max(240).optional() }),
]);

export async function POST(request: NextRequest, ctx: RouteContext<"/api/points/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const { db, sandbox, request: req } = c;
    const input = await readJson(req, Body);
    if (input.action === "suggestion") {
      await atCurrentTime(c, (simNow) => decidePointSuggestion(db, sandbox.id, id, { suggestionId: input.suggestionId, action: input.decision, text: input.text }, simNow));
      return { ok: true };
    }
    if (input.action === "delete") await deletePoint(db, sandbox.id, id);
    else await updatePoint(db, sandbox.id, id, input.values);
    return { ok: true };
  });
}
