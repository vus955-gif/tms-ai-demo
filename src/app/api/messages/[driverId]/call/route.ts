import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { alerts } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { setAlertStatus } from "@/server/alerts/repository";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { logCall } from "@/server/messages/gateway";
import { threadDetail } from "@/server/messages/threads";

const Body = z.object({
  note: z.string().max(500, "Najwyżej 500 znaków").default(""),
  /** Alert the call was about; with `resolve` it is closed together with the note. */
  alertId: z.string().max(64).nullable().optional(),
  resolve: z.boolean().default(false),
});

/** "Zadzwoń": a note from a call with the driver lands in their thread (and may close the alert, in one go). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/messages/[driverId]/call">) {
  const { driverId } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    await threadDetail(c.db, c.sandbox.id, driverId);
    return atCurrentTime(c, (simNow) =>
      c.db.transaction(async (tx) => {
        const [alert] = input.alertId ? await tx.select().from(alerts).where(and(eq(alerts.sandboxId, c.sandbox.id), eq(alerts.id, input.alertId))) : [];
        if (input.alertId && !alert) throw new HttpError(404, "Nie ma takiego alertu.");
        await logCall(tx, c.sandbox.id, { driverId, note: input.note, atSim: simNow });
        if (alert && input.resolve && alert.status !== "resolved") await setAlertStatus(tx, c.sandbox.id, alert.id, "resolved", simNow);
        return { ok: true };
      }),
    );
  });
}
