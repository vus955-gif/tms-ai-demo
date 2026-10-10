import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { vehicleDetail } from "@/server/monitoring/vehicle-detail";

/** Detail panel data: route driven/remaining, ETA breakdown, alternatives, recent activities. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/vehicles/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, ({ db, sandbox }) => vehicleDetail(db, sandbox.id, id, sandbox.lastTickSim));
}
