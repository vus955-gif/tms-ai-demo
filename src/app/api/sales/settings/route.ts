import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { setAgentActive, SettingsSchema, updateSettings } from "@/server/sales/actions";
import { salesSettingsView } from "@/server/sales/views";

export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => salesSettingsView(db, sandbox.id));
}

const Body = z.union([z.object({ agentId: z.string().min(1).max(64), active: z.boolean() }), z.object({ settings: SettingsSchema })]);

/** Automation switch, margins, road rates, and which agents get RFQs. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const input = await readJson(req, Body);
    if ("agentId" in input) await setAgentActive(db, sandbox.id, input.agentId, input.active);
    else await updateSettings(db, sandbox.id, input.settings);
    return salesSettingsView(db, sandbox.id);
  });
}
