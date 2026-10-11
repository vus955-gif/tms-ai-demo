import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { listDocuments } from "@/server/documents/cmr";
import { withSandbox } from "@/server/http";

/** Documents (CMR) sent by drivers, newest first, with AI reading and match candidates. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => ({ documents: await listDocuments(db, sandbox.id) }));
}
