import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { ordersBoard } from "@/server/orders/board";
import { createOrder, NewOrderSchema } from "@/server/orders/create";

/** Orders board: new orders, AI drafts and each driver's current order and queue. */
export async function GET(request: NextRequest) {
  return withSandbox(request, ({ db, sandbox }) => ordersBoard(db, sandbox.id));
}

/** Dispatcher creates a new order from the form. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (ctx) => {
    const input = await readJson(ctx.request, NewOrderSchema);
    return atCurrentTime(ctx, (simNow) => createOrder(ctx.db, ctx.sandbox.id, input, { simNow, source: "manual" }));
  });
}
