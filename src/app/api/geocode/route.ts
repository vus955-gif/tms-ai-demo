import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { geocode } from "@/server/clients/geocode";

/** "Znajdź na mapie": address → candidate locations (Nominatim, OpenStreetMap). */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ sandbox, request: req }) => {
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const country = req.nextUrl.searchParams.get("country") ?? "";
    return { hits: await geocode(sandbox.id, q.slice(0, 200), country) };
  });
}
