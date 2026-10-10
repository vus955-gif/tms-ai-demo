import type { NextRequest } from "next/server";
import { runDiagnostics } from "@/ai/status";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";

/** "Sprawdź AI": key present?, model capabilities, one tiny structured call. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => runDiagnostics(db, sandbox.id, sandbox.lastTickSim));
}
