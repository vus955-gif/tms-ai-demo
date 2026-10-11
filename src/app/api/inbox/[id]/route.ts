import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { messages } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { requestReplyDraft } from "@/server/inbox/actions";
import { markEmailThreadRead } from "@/server/inbox/gateway";
import { inboxThread } from "@/server/inbox/views";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/inbox/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => inboxThread(db, sandbox.id, id));
}

const Body = z.object({ action: z.enum(["read", "draft"]) });

/** Mark a thread read, or ask AI for a reply draft. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/inbox/[id]">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const { action } = await readJson(c.request, Body);
    if (action === "read") {
      const [root] = await c.db.select().from(messages).where(and(eq(messages.sandboxId, c.sandbox.id), eq(messages.id, id), eq(messages.party, "client")));
      if (!root) throw new HttpError(404, "Nie ma takiej wiadomości.");
      await markEmailThreadRead(c.db, c.sandbox.id, root.threadKey, c.sandbox.lastTickSim);
      return { ok: true };
    }
    return atCurrentTime(c, async (simNow) => ({ draftId: await requestReplyDraft(c.db, c.sandbox.id, id, simNow) }));
  });
}
