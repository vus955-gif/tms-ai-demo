import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { addContact, ClientUpdateSchema, ContactInputSchema, createPoint, PointInputSchema, updateClient } from "@/server/clients/clients";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), values: ClientUpdateSchema }),
  z.object({ action: z.literal("addContact"), contact: ContactInputSchema }),
  z.object({ action: z.literal("addPoint"), point: PointInputSchema }),
]);

export async function POST(request: NextRequest, ctx: RouteContext<"/api/clients/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const input = await readJson(req, Body);
    if (input.action === "update") {
      await updateClient(db, sandbox.id, id, input.values);
      return { ok: true };
    }
    if (input.action === "addContact") return { id: await addContact(db, sandbox.id, id, input.contact) };
    return { id: await createPoint(db, sandbox.id, id, input.point) };
  });
}
