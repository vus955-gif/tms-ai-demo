import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { ensureShipmentsSeeded } from "@/server/shipments/seed";
import { createShipment, ShipmentInputSchema } from "@/server/shipments/shipments";
import { shipmentFormOptions, shipmentsOverview } from "@/server/shipments/views";

/** Sea, air and rail shipments; worlds older than the module get the demo shipments on the first visit. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => {
    await ensureShipmentsSeeded(db, sandbox.id, sandbox.lastTickSim);
    return { shipments: await shipmentsOverview(db, sandbox.id, sandbox.lastTickSim), options: await shipmentFormOptions(db, sandbox.id) };
  });
}

export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, ShipmentInputSchema);
    return atCurrentTime(c, async (simNow) => ({ id: await createShipment(c.db, c.sandbox.id, input, simNow) }));
  });
}
