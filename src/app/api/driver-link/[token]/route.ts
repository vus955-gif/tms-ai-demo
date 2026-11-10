import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { withDriverLink } from "@/server/driver-link/http";
import { confirmByDriver, driverOrderView, REFUSAL_REASONS, refuseByDriver } from "@/server/driver-link/links";
import { readJson } from "@/server/http";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("refuse"), reason: z.enum(REFUSAL_REASONS) }),
]);

/** The driver's order page (link from the order SMS): this one order, for this one driver. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/driver-link/[token]">) {
  const { token } = await ctx.params;
  return withDriverLink((db) => driverOrderView(db, token, new Date()));
}

/** "Potwierdzam" or "Nie mogę jechać". */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/driver-link/[token]">) {
  const { token } = await ctx.params;
  return withDriverLink(async (db) => {
    const input = await readJson(request, Action);
    return input.action === "confirm" ? confirmByDriver(db, token, new Date()) : refuseByDriver(db, token, input.reason, new Date());
  });
}
