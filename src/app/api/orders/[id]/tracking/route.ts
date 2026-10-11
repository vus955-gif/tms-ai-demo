import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { createLink, extendLink, linkForOrder, revokeLink } from "@/server/tracking/links";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/tracking">) {
  const { id } = await ctx.params;
  return withSandbox(request, async ({ db, sandbox }) => ({ link: await linkForOrder(db, sandbox.id, id, sandbox.lastTickSim) }));
}

const Body = z.object({ action: z.enum(["create", "extend", "revoke"]) });

/** Client tracking link for one order: create, extend by 2 h, or switch off. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/tracking">) {
  const { id } = await ctx.params;
  return withSandbox(request, async (c) => {
    const { action } = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => {
      if (action === "create") return { link: await createLink(c.db, c.sandbox.id, id, simNow) };
      if (action === "extend") return { link: await extendLink(c.db, c.sandbox.id, id, simNow) };
      await revokeLink(c.db, c.sandbox.id, id);
      return { link: null };
    });
  });
}
