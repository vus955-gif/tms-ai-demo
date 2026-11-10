import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { recordFleetTerm } from "@/server/fleet/service-documents";
import { renewFleetTerm } from "@/server/fleet/views";
import { readJson, withSandbox } from "@/server/http";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("renew") }),
  z.object({
    action: z.literal("record"),
    performedOn: z.string().max(10).nullable(),
    validUntil: z.string().max(10).nullable(),
    nextKm: z.number().int().nullable(),
    docNumber: z.string().max(60),
  }),
]);

/**
 * "Odnotuj wykonanie" (renew: done today, next deadline from the rules) or
 * "Zapisz w kartotece" (record: dates and numbers from a service document, approved by the dispatcher).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/fleet/terms/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    const termId = decodeURIComponent(id);
    return atCurrentTime(c, async (simNow) => {
      if (input.action === "renew") {
        await renewFleetTerm(c.db, c.sandbox.id, termId, simNow);
        return { ok: true };
      }
      return { ok: true, ...(await recordFleetTerm(c.db, c.sandbox.id, termId, input, simNow)) };
    });
  });
}
