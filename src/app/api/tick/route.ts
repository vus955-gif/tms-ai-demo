import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { buildSnapshot } from "@/server/snapshot";
import { runTick } from "@/server/tick/engine";

/** Advances the visitor's world to "now" and returns the current snapshot. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, realNow }) => {
    const tick = await runTick(db, sandbox.id, realNow);
    return buildSnapshot(db, tick.sandbox, tick.simNow, realNow, tick);
  });
}
