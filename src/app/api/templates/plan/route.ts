import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { createPlanned } from "@/server/templates/templates";

// Up to MAX_TEMPLATES templates × 7 days.
const Body = z.object({ keys: z.array(z.string().max(120)).min(1).max(200) });

/** "Utwórz zaznaczone": the selected recurring orders become new orders in one click. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const { keys } = await readJson(c.request, Body);
    return atCurrentTime(c, (simNow) => createPlanned(c.db, c.sandbox, keys, simNow));
  });
}
