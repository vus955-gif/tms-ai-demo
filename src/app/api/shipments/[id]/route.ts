import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import {
  cancelShipment,
  confirmMilestone,
  discardClientUpdate,
  draftClientUpdate,
  requestAgentStatusNow,
  sendClientUpdate,
  ShipmentSettingsSchema,
  updateShipmentSettings,
} from "@/server/shipments/shipments";
import { shipmentDetail } from "@/server/shipments/views";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/shipments/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => shipmentDetail(db, sandbox.id, id, sandbox.lastTickSim));
}

const Id = z.string().min(1).max(80);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), milestoneId: Id, at: z.string().max(40).nullable().optional() }),
  z.object({ action: z.literal("askAgent") }),
  z.object({ action: z.literal("draftUpdate") }),
  z.object({ action: z.literal("sendUpdate"), draftId: Id, subject: z.string().trim().min(1, "Temat jest pusty.").max(200), body: z.string().trim().min(1, "Treść jest pusta.").max(4000) }),
  z.object({ action: z.literal("discardUpdate"), draftId: Id }),
  z.object({ action: z.literal("settings"), values: ShipmentSettingsSchema }),
  z.object({ action: z.literal("cancel") }),
]);

/** Forwarder actions on one shipment. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/shipments/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      switch (input.action) {
        case "confirm":
          await confirmMilestone(c.db, c.sandbox.id, id, input.milestoneId, input.at ?? null, simNow);
          return { ok: true };
        case "askAgent":
          return { messageId: await requestAgentStatusNow(c.db, c.sandbox.id, id, simNow) };
        case "draftUpdate":
          return { draftId: await draftClientUpdate(c.db, c.sandbox.id, id, simNow) };
        case "sendUpdate":
          await sendClientUpdate(c.db, c.sandbox.id, id, input.draftId, { subject: input.subject, body: input.body }, simNow);
          return { ok: true };
        case "discardUpdate":
          await discardClientUpdate(c.db, c.sandbox.id, id, input.draftId);
          return { ok: true };
        case "settings":
          await updateShipmentSettings(c.db, c.sandbox.id, id, input.values, simNow);
          return { ok: true };
        case "cancel":
          await cancelShipment(c.db, c.sandbox.id, id, simNow);
          return { ok: true };
      }
    });
  });
}
