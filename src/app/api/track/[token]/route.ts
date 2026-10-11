import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import "@/server/bootstrap";
import { HttpError } from "@/server/http";
import { publicTracking } from "@/server/tracking/links";

/** Public client tracking (no demo world cookie): one transport, client-safe data only. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/track/[token]">) {
  const { token } = await ctx.params;
  try {
    const db = await getDb();
    return NextResponse.json(await publicTracking(db, token, new Date()), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[track]", error);
    return NextResponse.json({ error: "Nie udało się wczytać śledzenia. Spróbuj za chwilę." }, { status: 500 });
  }
}
