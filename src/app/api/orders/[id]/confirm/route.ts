import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { withSandbox } from "@/server/http";
import { confirmOrder } from "@/server/orders/assign";

/** Dispatcher confirms on the driver's behalf. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/confirm">) {
  const { id } = await ctx.params;
  return withSandbox(request, (c) =>
    atCurrentTime(c, async (simNow) => {
      await c.db.transaction((tx) => confirmOrder(tx, c.sandbox.id, id, simNow));
      return { ok: true };
    }),
  );
}
