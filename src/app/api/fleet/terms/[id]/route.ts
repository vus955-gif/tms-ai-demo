import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { renewFleetTerm } from "@/server/fleet/views";
import { readJson, withSandbox } from "@/server/http";

const Body = z.object({ action: z.literal("renew") });

/** "Odnotuj wykonanie": the inspection/renewal was done today. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/fleet/terms/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      await renewFleetTerm(c.db, c.sandbox.id, decodeURIComponent(id), simNow);
      return { ok: true };
    });
  });
}
