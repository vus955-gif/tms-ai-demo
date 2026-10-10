import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { sendToDriver } from "@/server/messages/gateway";
import { threadDetail } from "@/server/messages/threads";

const Body = z.object({ body: z.string().trim().min(1, "Wpisz treść wiadomości").max(500, "Najwyżej 500 znaków") });

export async function GET(request: NextRequest, ctx: RouteContext<"/api/messages/[driverId]">) {
  const { driverId } = await ctx.params;
  return withSandbox(request, ({ db, sandbox }) => threadDetail(db, sandbox.id, driverId));
}

/** Dispatcher replies from the app instead of the phone. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/messages/[driverId]">) {
  const { driverId } = await ctx.params;
  return withSandbox(request, async (c) => {
    const { body } = await readJson(c.request, Body);
    await threadDetail(c.db, c.sandbox.id, driverId);
    return atCurrentTime(c, async (simNow) => {
      await sendToDriver(c.db, c.sandbox.id, { driverId, body, kind: "chat", sentBy: "dispatcher", atSim: simNow });
      return threadDetail(c.db, c.sandbox.id, driverId);
    });
  });
}
