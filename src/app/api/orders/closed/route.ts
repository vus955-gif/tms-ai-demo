import type { NextRequest } from "next/server";
import "@/server/bootstrap";
import { withSandbox } from "@/server/http";
import { listClosedOrders } from "@/server/orders/closed";

/** "Zamknięte zlecenia": finished runs with what invoicing needs, and whether each was already exported. */
export async function GET(request: NextRequest) {
  return withSandbox(request, ({ db, sandbox }) => listClosedOrders(db, sandbox.id));
}
