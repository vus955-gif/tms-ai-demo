import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { withSandbox } from "@/server/http";
import { unassignOrder } from "@/server/orders/assign";

/** Take the order back from the driver (cancellation SMS). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/unassign">) {
  const { id } = await ctx.params;
  return withSandbox(request, (c) =>
    atCurrentTime(c, async (simNow) => {
      await c.db.transaction((tx) => unassignOrder(tx, c.sandbox.id, id, simNow));
      return { ok: true };
    }),
  );
}
