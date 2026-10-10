import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { withSandbox } from "@/server/http";
import { cancelOrder } from "@/server/orders/assign";

/** Cancel the order before loading. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/cancel">) {
  const { id } = await ctx.params;
  return withSandbox(request, (c) =>
    atCurrentTime(c, async (simNow) => {
      await c.db.transaction((tx) => cancelOrder(tx, c.sandbox.id, id, simNow));
      return { ok: true };
    }),
  );
}
