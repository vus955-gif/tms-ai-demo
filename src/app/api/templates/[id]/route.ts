import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { deleteTemplate, saveTemplate, setTemplateActive, TemplateInputSchema } from "@/server/templates/templates";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), values: z.unknown() }),
  z.object({ action: z.literal("active"), active: z.boolean() }),
  z.object({ action: z.literal("delete") }),
]);

export async function POST(request: NextRequest, ctx: RouteContext<"/api/templates/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      if (input.action === "active") await setTemplateActive(c.db, c.sandbox.id, id, input.active);
      else if (input.action === "delete") await deleteTemplate(c.db, c.sandbox.id, id);
      else {
        const parsed = TemplateInputSchema.safeParse(input.values);
        if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
        await saveTemplate(c.db, c.sandbox.id, parsed.data, simNow, id);
      }
      return { ok: true };
    });
  });
}
