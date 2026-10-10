import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { listThreads } from "@/server/messages/threads";

/** Messenger: one thread per driver with unread counts and AI priority. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => ({ threads: await listThreads(db, sandbox.id) }));
}
