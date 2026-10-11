import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { TransitionError } from "@/domain/order-lifecycle";
import { hashIp, SANDBOX_COOKIE, sandboxCookieOptions } from "./sandbox/cookie";
import { cleanupExpired, getOrCreateSandbox, type SandboxRow } from "./sandbox/repository";

export type SandboxContext = { db: Db; sandbox: SandboxRow; realNow: Date; request: NextRequest };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

export async function readJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Niepoprawny JSON w treści żądania");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `Niepoprawne dane: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

/**
 * Resolves (or creates) the visitor's demo world, runs the handler and sets the
 * world cookie when a new world was created. Errors become JSON responses.
 */
export async function withSandbox(
  request: NextRequest,
  handler: (ctx: SandboxContext) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const db = await getDb();
    const realNow = new Date();
    await cleanupExpired(db, realNow);
    const { sandbox, created } = await getOrCreateSandbox(db, {
      cookieValue: request.cookies.get(SANDBOX_COOKIE)?.value,
      ipHash: hashIp(clientIp(request)),
      realNow,
    });
    const result = await handler({ db, sandbox, realNow, request });
    const response = result instanceof NextResponse ? result : NextResponse.json(result);
    if (created) response.cookies.set(SANDBOX_COOKIE, sandbox.id, sandboxCookieOptions());
    return response;
  } catch (error) {
    // Next.js signals (e.g. "this route is dynamic" while prerendering) must reach the framework.
    unstable_rethrow(error);
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TransitionError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[api]", error);
    return NextResponse.json({ error: "Coś poszło nie tak po stronie serwera. Spróbuj ponownie." }, { status: 500 });
  }
}
