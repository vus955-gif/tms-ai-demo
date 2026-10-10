import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { applyClockAction, ClockActionSchema } from "@/server/clock-actions";
import { readJson, withSandbox } from "@/server/http";
import { getSandbox } from "@/server/sandbox/repository";
import { buildSnapshot } from "@/server/snapshot";
import { runTick } from "@/server/tick/engine";

/** Pause, resume or change the simulation speed (1x / 10x / 60x). */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, realNow, request: req }) => {
    const action = await readJson(req, ClockActionSchema);
    // Catch up to "now" under the old clock first, so changing speed never rewrites history.
    await runTick(db, sandbox.id, realNow);
    const current = (await getSandbox(db, sandbox.id))!;
    const updated = await applyClockAction(db, current, action, realNow);
    const tick = await runTick(db, updated.id, realNow);
    return buildSnapshot(db, tick.sandbox, tick.simNow, realNow, tick);
  });
}
