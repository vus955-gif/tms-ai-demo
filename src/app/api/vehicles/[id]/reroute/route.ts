import type { NextRequest } from "next/server";
import { z } from "zod";
import { ROUTE_KEY_RE } from "@/adapters/routing/static-routes";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { applyReroute } from "@/server/monitoring/vehicle-detail";
import { buildSnapshot } from "@/server/snapshot";
import { runTick } from "@/server/tick/engine";

const Body = z.object({ routeKey: z.string().max(200).regex(ROUTE_KEY_RE, "Niepoprawny klucz trasy") });

/** "Zastosuj objazd": the vehicle continues on the alternative route. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/vehicles/[id]/reroute">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox, realNow, request: req }) => {
    const { routeKey } = await readJson(req, Body);
    const before = await runTick(db, sandbox.id, realNow);
    await applyReroute(db, sandbox.id, id, routeKey, before.simNow);
    const tick = await runTick(db, sandbox.id, realNow);
    return buildSnapshot(db, tick.sandbox, tick.simNow, realNow, tick);
  });
}
