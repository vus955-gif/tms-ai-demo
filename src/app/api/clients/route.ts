import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { readJson, withSandbox } from "@/server/http";
import { ClientInputSchema, clientsOverview, createClient } from "@/server/clients/clients";
import { geocoderEnabled } from "@/server/clients/geocode";

/** The client book: clients, contacts and points. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => ({ clients: await clientsOverview(db, sandbox.id), geocoder: geocoderEnabled() }));
}

export async function POST(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox, request: req }) => {
    const input = await readJson(req, ClientInputSchema);
    return { id: await createClient(db, sandbox.id, input) };
  });
}
