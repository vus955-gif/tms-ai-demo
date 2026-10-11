import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { listTemplates, saveTemplate, TemplateInputSchema, weekPlan } from "@/server/templates/templates";
import { z } from "zod";

/** Templates and next week's plan with the timeliness forecast. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => {
    const templates = await listTemplates(db, sandbox);
    return { templates, plan: await weekPlan(db, sandbox, sandbox.lastTickSim, templates) };
  });
}

export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const parsed = TemplateInputSchema.safeParse(await readJson(c.request, z.unknown()));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
    return atCurrentTime(c, async (simNow) => ({ id: await saveTemplate(c.db, c.sandbox.id, parsed.data, simNow) }));
  });
}
