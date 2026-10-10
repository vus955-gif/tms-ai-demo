import { and, eq, isNotNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { clientContacts, clients, points } from "@/db/schema";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";

export type CatalogClient = {
  id: string;
  name: string;
  isKey: boolean;
  points: { id: string; name: string; city: string; country: string; address: string; openingHours: string; requirements: string; notes: string }[];
  contacts: { id: string; name: string; email: string }[];
};

/** Clients with their book of points (for the order form and the client mail tool). */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => {
    const [clientRows, pointRows, contactRows] = await Promise.all([
      db.select().from(clients).where(eq(clients.sandboxId, sandbox.id)),
      db.select().from(points).where(and(eq(points.sandboxId, sandbox.id), isNotNull(points.clientId))),
      db.select().from(clientContacts).where(eq(clientContacts.sandboxId, sandbox.id)),
    ]);
    const catalog: CatalogClient[] = clientRows
      .sort((a, b) => a.name.localeCompare(b.name, "pl"))
      .map((c) => ({
        id: c.id,
        name: c.name,
        isKey: c.isKey,
        points: pointRows
          .filter((p) => p.clientId === c.id)
          .map((p) => ({ id: p.id, name: p.name, city: p.city, country: p.country, address: p.address, openingHours: p.openingHours, requirements: p.requirements, notes: p.notes })),
        contacts: contactRows.filter((k) => k.clientId === c.id).map((k) => ({ id: k.id, name: k.name, email: k.email })),
      }));
    return { clients: catalog };
  });
}
