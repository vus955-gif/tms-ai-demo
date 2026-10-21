import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { adviseRun } from "@/server/templates/templates";

const Body = z.object({ key: z.string().min(3).max(120) });

/** "Doradź" on a red or amber day of the weekly plan. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const { key } = await readJson(req, Body);
    return adviseRun(db, sandbox, key, sandbox.lastTickSim);
  });
}
