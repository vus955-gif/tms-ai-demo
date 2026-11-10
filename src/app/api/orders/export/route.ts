import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { exportClosedOrders } from "@/server/orders/closed";

const Body = z.object({ orderIds: z.array(z.string().min(1).max(64)).min(1).max(500) });

/** Invoicing export: returns a CSV file with the chosen closed orders and marks them as exported. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (ctx) => {
    const { orderIds } = await readJson(ctx.request, Body);
    return atCurrentTime(ctx, async (simNow) => {
      const { filename, csv, count } = await exportClosedOrders(ctx.db, ctx.sandbox.id, orderIds, simNow);
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
          "x-exported-count": String(count),
        },
      });
    });
  });
}
