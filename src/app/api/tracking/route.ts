import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { HttpError, withSandbox } from "@/server/http";
import { sharedWithClient } from "@/server/tracking/links";

/** Demo "client account": transports shared with one client. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId || clientId.length > 64) throw new HttpError(400, "Wybierz klienta.");
    return { links: await sharedWithClient(db, sandbox.id, clientId, sandbox.lastTickSim) };
  });
}
