import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { assignOrder } from "@/server/orders/assign";
import { assertAssignable } from "@/server/orders/board";

const Body = z.object({ driverId: z.string().min(1).max(64) });

/** Drag & drop: assign the order to a driver and send the order SMS. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/assign">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const { driverId } = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      await assertAssignable(c.db, c.sandbox.id, id, driverId, simNow);
      await c.db.transaction((tx) => assignOrder(tx, c.sandbox.id, id, driverId, { actor: "dispatcher", simNow }));
      return { ok: true };
    });
  });
}
