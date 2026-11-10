import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { draftHandover, handoverView, saveHandover } from "@/server/handover/handover";
import { readJson, withSandbox } from "@/server/http";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft") }),
  z.object({ action: z.literal("save"), body: z.string().max(3000), source: z.enum(["ai", "rules", "reczna"]) }),
]);

/** "Przekazanie zmiany": the state of things right now and the last notes left for the next shift. */
export async function GET(request: NextRequest) {
  return withSandbox(request, (c) => atCurrentTime(c, (simNow) => handoverView(c.db, c.sandbox, simNow)));
}

/** Draft a note from the current facts (AI, or the plain sections without it), or save the note as edited. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    return atCurrentTime(c, async (simNow) => (input.action === "draft" ? draftHandover(c.db, c.sandbox, simNow) : { saved: await saveHandover(c.db, c.sandbox, input, simNow) }));
  });
}
