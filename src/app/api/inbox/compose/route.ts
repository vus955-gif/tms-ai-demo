import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { composeDelayNotice } from "@/server/inbox/actions";

const Body = z.object({ orderId: z.string().min(1).max(64) });

/** Alert action "Powiadom klienta": draft a delay notice for the order's client. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const { orderId } = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => ({ rootId: await composeDelayNotice(c.db, c.sandbox.id, orderId, simNow) }));
  });
}
