import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { listQuotes } from "@/server/sales/views";

/** Sales: quote requests, newest first. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => ({ quotes: await listQuotes(db, sandbox.id) }));
}
