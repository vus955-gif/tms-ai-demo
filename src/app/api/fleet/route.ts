import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { fleetFile } from "@/server/fleet/views";
import { withSandbox } from "@/server/http";

/** Fleet file: deadlines of vehicles, trailers and drivers with their status. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => fleetFile(db, sandbox, sandbox.lastTickSim));
}
