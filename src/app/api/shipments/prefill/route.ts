import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { HttpError, withSandbox } from "@/server/http";
import { shipmentPrefill } from "@/server/shipments/views";

/** "Utwórz przesyłkę" on a won quote: what the form can fill in from the quote. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => {
    const quoteId = request.nextUrl.searchParams.get("quote");
    if (!quoteId || quoteId.length > 64) throw new HttpError(400, "Brak wyceny.");
    return shipmentPrefill(db, sandbox.id, quoteId);
  });
}
