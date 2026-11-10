import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { orderHistory } from "@/server/orders/history";

/** The life of one order: every recorded status change with who made it and why. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/history">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => orderHistory(db, sandbox.id, id));
}
