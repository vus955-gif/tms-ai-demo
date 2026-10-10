import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { drivers, sandboxes } from "@/db/schema";
import "@/server/bootstrap";
import { HttpError, readJson, withSandbox } from "@/server/http";

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
