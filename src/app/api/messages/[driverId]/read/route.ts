import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { markThreadRead } from "@/server/messages/threads";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/messages/[driverId]/read">) {
  const { driverId } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => {
    await markThreadRead(db, sandbox.id, driverId, sandbox.lastTickSim);
    return { ok: true };
  });
}
