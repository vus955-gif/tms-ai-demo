import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { discardDraft, sendDraft } from "@/server/inbox/actions";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    subject: z.string().trim().min(1, "Temat nie może być pusty").max(200),
    body: z.string().trim().min(1, "Treść nie może być pusta").max(4000, "Najwyżej 4000 znaków"),
  }),
  z.object({ action: z.literal("discard") }),
]);

/** Send (demo: only marked as sent, nothing leaves the app) or discard a reply draft. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/inbox/drafts/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      if (input.action === "send") await sendDraft(c.db, c.sandbox.id, id, input, simNow);
      else await discardDraft(c.db, c.sandbox.id, id);
      return { ok: true };
    });
  });
}
