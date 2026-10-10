import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { resetSandbox } from "@/server/sandbox/repository";
import { buildSnapshot } from "@/server/snapshot";
import { runTick } from "@/server/tick/engine";

const Body = z.object({ randomRun: z.boolean().optional() });

/** Throws the world away and starts the scenario again (optionally with a random seed). */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, realNow, request: req }) => {
    const body = await readJson(req, Body);
    const fresh = await resetSandbox(db, sandbox.id, realNow, { randomRun: body.randomRun });
    const tick = await runTick(db, fresh.id, realNow);
    return buildSnapshot(db, tick.sandbox, tick.simNow, realNow, tick);
  });
}
