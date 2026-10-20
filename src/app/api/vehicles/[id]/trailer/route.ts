import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { swapTrailerSafely, trailerSituation } from "@/server/fleet/trailers";

/** "Przepnij naczepę": the tractor's trailer now, the free ones and what each change would mean. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/vehicles/[id]/trailer">) {
  const { id } = await ctx.params;
  return withSandbox(request, ({ db, sandbox }) => trailerSituation(db, sandbox, id, sandbox.lastTickSim));
}

const Body = z.object({ trailerId: z.string().min(1).max(64).nullable(), confirm: z.boolean().default(false) });

/** Records a swap (or a drop with `trailerId: null`) done in the yard. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/vehicles/[id]/trailer">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => swapTrailerSafely(c.db, c.sandbox, id, input.trailerId, { confirm: input.confirm }, simNow));
  });
}
