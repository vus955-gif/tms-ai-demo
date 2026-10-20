import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { deletePoint, PointUpdateSchema, updatePoint } from "@/server/clients/clients";

const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("update"), values: PointUpdateSchema }), z.object({ action: z.literal("delete") })]);

export async function POST(request: NextRequest, ctx: RouteContext<"/api/points/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const input = await readJson(req, Body);
    if (input.action === "delete") await deletePoint(db, sandbox.id, id);
    else await updatePoint(db, sandbox.id, id, input.values);
    return { ok: true };
  });
}
