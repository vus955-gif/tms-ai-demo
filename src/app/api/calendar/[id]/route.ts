import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { removeAbsence } from "@/server/fleet/views";
import { readJson, withSandbox } from "@/server/http";

const Body = z.object({ action: z.literal("remove") });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/calendar/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    await readJson(req, Body);
    await removeAbsence(db, sandbox.id, id);
    return { ok: true };
  });
}
