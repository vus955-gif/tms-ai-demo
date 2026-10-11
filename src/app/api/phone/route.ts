import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { drivers, orders, sandboxes } from "@/db/schema";
import "@/server/bootstrap";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { cmrSamples } from "@/simulation/scenario/cmr-samples";

const Body = z.object({ driverId: z.string().max(64).nullable() });

/** "Telefon kierowcy": choose which driver the visitor plays (that driver's bot goes quiet). */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const { driverId } = await readJson(req, Body);
    if (driverId) {
      const [driver] = await db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.sandboxId, sandbox.id), eq(drivers.id, driverId)));
      if (!driver) throw new HttpError(404, "Nie ma takiego kierowcy.");
    }
    await db.update(sandboxes).set({ phoneDriverId: driverId }).where(eq(sandboxes.id, sandbox.id));
    return { ok: true, driverId };
  });
}

/** CMR photos the played driver can "take": papers of their own orders plus one foreign document. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const driverId = req.nextUrl.searchParams.get("driverId") ?? "";
    const own = await db.select({ id: orders.id, status: orders.status }).from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.driverId, driverId)));
    const unloaded = new Set(own.filter((o) => ["ROZLADUNEK", "DO_ZAMKNIECIA", "ZAMKNIETE"].includes(o.status)).map((o) => o.id));
    const ids = new Set(own.map((o) => o.id));
    const samples = cmrSamples
      .filter((s) => s.orderId === null || ids.has(s.orderId))
      .map((s) => ({ id: s.id, label: s.label, file: s.file, orderNumber: s.orderNumber, unloaded: s.orderId ? unloaded.has(s.orderId) : false }));
    return { samples };
  });
}
