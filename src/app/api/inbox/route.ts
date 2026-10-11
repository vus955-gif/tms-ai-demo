import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { listInbox } from "@/server/inbox/views";

/** Client mailbox: one row per e-mail thread, unread and high priority first. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => ({ items: await listInbox(db, sandbox.id) }));
}
