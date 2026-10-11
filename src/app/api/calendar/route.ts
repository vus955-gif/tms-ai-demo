import type { NextRequest } from "next/server";
import { z } from "zod";
import { ABSENCE_KINDS } from "@/db/schema";
import "@/server/bootstrap";
import { addAbsence, driverCalendar } from "@/server/fleet/views";
import { readJson, withSandbox } from "@/server/http";

/** Driver calendar: a week of absences and orders, from today (+offset days). */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const offset = Math.max(-28, Math.min(56, Math.round(Number(req.nextUrl.searchParams.get("offset")) || 0)));
    return driverCalendar(db, sandbox, sandbox.lastTickSim, offset);
  });
}

const Body = z.object({
  driverId: z.string().min(1).max(64),
  kind: z.enum(ABSENCE_KINDS),
  from: z.string().max(10),
  to: z.string().max(10),
  note: z.string().max(200).default(""),
});

export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const input = await readJson(req, Body);
    return { id: await addAbsence(db, sandbox.id, input) };
  });
}
