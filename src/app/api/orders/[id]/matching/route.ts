import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { matchOrder } from "@/server/orders/board";

/** "Klocki": fit of every driver for this order, with reasons. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/matching">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => ({ results: await matchOrder(db, sandbox.id, id, sandbox.lastTickSim) }));
}
