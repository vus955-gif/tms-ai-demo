import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { discardAgentDraft, sendAgentDraft } from "@/server/sales/actions";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    subject: z.string().trim().min(1, "Temat nie może być pusty").max(200),
    body: z.string().trim().min(1, "Treść nie może być pusta").max(4000),
  }),
  z.object({ action: z.literal("discard") }),
]);

/** Send (demo: store) or discard a draft to a freight agent. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/sales/agent-drafts/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      if (input.action === "send") await sendAgentDraft(c.db, c.sandbox.id, id, input, simNow);
      else await discardAgentDraft(c.db, c.sandbox.id, id);
      return { ok: true };
    });
  });
}
