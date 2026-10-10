import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { setAlertStatus } from "@/server/alerts/repository";
import { HttpError, readJson, withSandbox } from "@/server/http";

const Body = z.object({ action: z.enum(["ack", "resolve"]) });

/** Mark an alert as seen (ack) or close it (resolve). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/alerts/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const { action } = await readJson(req, Body);
    const row = await setAlertStatus(db, sandbox.id, id, action === "ack" ? "acknowledged" : "resolved", sandbox.lastTickSim);
    if (!row) throw new HttpError(404, "Nie ma takiego alertu.");
    return { ok: true };
  });
}
