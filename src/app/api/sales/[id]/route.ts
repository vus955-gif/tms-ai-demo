import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { approveSending, DetailsPatchSchema, draftNegotiation, draftOffer, recalcRoad, selectRate, setOutcome, updateDetails } from "@/server/sales/actions";
import { quoteDetail } from "@/server/sales/views";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/sales/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => quoteDetail(db, sandbox.id, id));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("details"), patch: DetailsPatchSchema }),
  z.object({ action: z.literal("select"), agentQuoteId: z.string().min(1).max(64), marginPct: z.number().min(0).max(100) }),
  z.object({
    action: z.literal("road"),
    kmOverride: z.number().min(1).max(10000).nullable().optional(),
    emptyKm: z.number().min(0).max(3000).optional(),
    marginPct: z.number().min(0).max(100).optional(),
    vehicleKind: z.enum(["bus", "solo", "tractor"]).optional(),
  }),
  z.object({ action: z.literal("offer") }),
  z.object({ action: z.literal("negotiate"), agentQuoteId: z.string().min(1).max(64), target: z.number().positive().max(10_000_000) }),
  z.object({ action: z.literal("outcome"), value: z.enum(["wygrana", "przegrana", "anulowana"]) }),
]);

/** Salesperson actions on one quote. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/sales/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      switch (input.action) {
        case "approve":
          await approveSending(c.db, c.sandbox.id, id, simNow);
          return { ok: true };
        case "details":
          await updateDetails(c.db, c.sandbox.id, id, input.patch, simNow);
          return { ok: true };
        case "select":
          await selectRate(c.db, c.sandbox.id, id, input.agentQuoteId, input.marginPct);
          return { ok: true };
        case "road":
          return { calculation: await recalcRoad(c.db, c.sandbox.id, id, input) };
        case "offer":
          return { draftId: await draftOffer(c.db, c.sandbox.id, id, simNow) };
        case "negotiate":
          return { draftId: await draftNegotiation(c.db, c.sandbox.id, id, input.agentQuoteId, input.target, simNow) };
        case "outcome":
          await setOutcome(c.db, c.sandbox.id, id, input.value, simNow);
          return { ok: true };
      }
    });
  });
}
