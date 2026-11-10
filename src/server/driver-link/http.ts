import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { TransitionError } from "@/domain/order-lifecycle";
import { HttpError } from "../http";

/**
 * Public driver-page endpoints: no demo-world cookie (the driver's phone has none) — the token in the
 * address decides which world and order the request belongs to. Errors become short Polish messages.
 */
export async function withDriverLink(handler: (db: Db) => Promise<unknown>): Promise<NextResponse> {
  try {
    const db = await getDb();
    return NextResponse.json(await handler(db), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    // Someone else changed the order in the same moment (e.g. the dispatcher cancelled it).
    if (error instanceof TransitionError) return NextResponse.json({ error: "Zlecenie właśnie się zmieniło. Odśwież stronę." }, { status: 409 });
    console.error("[driver-link]", error);
    return NextResponse.json({ error: "Coś poszło nie tak. Spróbuj za chwilę albo zadzwoń do spedycji." }, { status: 500 });
  }
}
