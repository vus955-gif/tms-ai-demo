import { and, eq, inArray } from "drizzle-orm";
import { clients, documents, drivers, orders, orderStatusChanges, points, trailers, vehicles } from "@/db/schema";
import type { Executor } from "@/db/types";
import { getRoute, registerPointCoords } from "@/adapters/routing/static-routes";
import { COUNTRY_NAMES } from "@/domain/countries";
import { buildInvoiceCsv, invoiceCsvFilename, type InvoiceRow } from "@/domain/invoice-export";
import { isApproxRoute } from "@/simulation/approx-route";
import { HttpError } from "../http";

/** A closed order as the "Zamknięte zlecenia" list shows it. Dates are ISO strings. */
export type ClosedOrder = Omit<InvoiceRow, "loadedAt" | "unloadedAt" | "closedAt"> & {
  id: string;
  loadedAt: string;
  unloadedAt: string;
  closedAt: string | null;
  /** When the order went out in an invoicing export; null = not exported yet. */
  exportedAt: string | null;
};

type Loaded = { row: InvoiceRow; id: string; exportedAt: Date | null };

async function loadClosed(db: Executor, sandboxId: string, orderIds?: string[]): Promise<Loaded[]> {
  if (orderIds && orderIds.length === 0) return [];
  const where = and(eq(orders.sandboxId, sandboxId), eq(orders.status, "ZAMKNIETE"), orderIds ? inArray(orders.id, orderIds) : undefined);
  const rows = await db.select().from(orders).where(where);
  if (rows.length === 0) return [];

  const [clientRows, pointRows, vehicleRows, trailerRows, driverRows, closings, cmrDocs] = await Promise.all([
    db.select().from(clients).where(eq(clients.sandboxId, sandboxId)),
    db.select().from(points).where(eq(points.sandboxId, sandboxId)),
    db.select({ id: vehicles.id, plates: vehicles.plates }).from(vehicles).where(eq(vehicles.sandboxId, sandboxId)),
    db.select({ id: trailers.id, plates: trailers.plates }).from(trailers).where(eq(trailers.sandboxId, sandboxId)),
    db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName }).from(drivers).where(eq(drivers.sandboxId, sandboxId)),
    db
      .select({ orderId: orderStatusChanges.orderId, atSim: orderStatusChanges.atSim })
      .from(orderStatusChanges)
      .where(and(eq(orderStatusChanges.sandboxId, sandboxId), eq(orderStatusChanges.toStatus, "ZAMKNIETE"))),
    db
      .select({ orderId: documents.matchedOrderId })
      .from(documents)
      .where(and(eq(documents.sandboxId, sandboxId), eq(documents.status, "zatwierdzony"))),
  ]);
  // Points added in the app have no precomputed road route: their distance is an estimate from coordinates.
  registerPointCoords(pointRows);
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const clientOf = byId(clientRows);
  const pointOf = byId(pointRows);
  const vehicleOf = byId(vehicleRows);
  const trailerOf = byId(trailerRows);
  const driverOf = byId(driverRows);
  const closedAt = new Map<string, Date>();
  for (const c of closings) {
    const prev = closedAt.get(c.orderId);
    if (!prev || c.atSim > prev) closedAt.set(c.orderId, c.atSim);
  }
  const withCmr = new Set(cmrDocs.map((d) => d.orderId).filter((id): id is string => id !== null));

  return rows
    .map((o) => {
      const pickup = pointOf.get(o.pickupPointId);
      const delivery = pointOf.get(o.deliveryPointId);
      const driver = o.driverId ? driverOf.get(o.driverId) : undefined;
      let distanceKm: number | null = null;
      let distanceApprox = false;
      try {
        const route = getRoute(o.pickupPointId, o.deliveryPointId);
        distanceKm = Math.round(route.distanceM / 1000);
        distanceApprox = isApproxRoute(route);
      } catch {
        // No route at all (a point removed since): the distance stays empty rather than guessed.
      }
      const row: InvoiceRow = {
        number: o.number,
        clientName: clientOf.get(o.clientId)?.name ?? "",
        clientTaxId: clientOf.get(o.clientId)?.taxId ?? "",
        references: o.references,
        pickupName: pickup?.name ?? "",
        pickupCity: pickup?.city ?? "",
        pickupCountry: pickup ? COUNTRY_NAMES[pickup.country] : "",
        loadedAt: o.departedPickupAt ?? o.pickupTo,
        deliveryName: delivery?.name ?? "",
        deliveryCity: delivery?.city ?? "",
        deliveryCountry: delivery ? COUNTRY_NAMES[delivery.country] : "",
        unloadedAt: o.unloadedAt ?? o.deliveryTo,
        cargoPallets: o.cargoPallets,
        cargoKg: o.cargoKg,
        distanceKm,
        distanceApprox,
        vehiclePlates: (o.vehicleId && vehicleOf.get(o.vehicleId)?.plates) || "",
        trailerPlates: (o.trailerId && trailerOf.get(o.trailerId)?.plates) || "",
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : "",
        cmrOnFile: withCmr.has(o.id),
        closedAt: closedAt.get(o.id) ?? null,
      };
      return { row, id: o.id, exportedAt: o.invoiceExportedAt };
    })
    .sort((a, b) => (b.row.closedAt?.getTime() ?? 0) - (a.row.closedAt?.getTime() ?? 0) || a.row.number.localeCompare(b.row.number));
}

/** Closed orders, most recently closed first. */
export async function listClosedOrders(db: Executor, sandboxId: string): Promise<{ orders: ClosedOrder[] }> {
  const loaded = await loadClosed(db, sandboxId);
  return {
    orders: loaded.map(({ row, id, exportedAt }) => ({
      ...row,
      id,
      loadedAt: row.loadedAt.toISOString(),
      unloadedAt: row.unloadedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      exportedAt: exportedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Builds the invoicing CSV for the chosen closed orders and stamps them as exported.
 * Orders exported before can be exported again (a lost file happens); the stamp then moves to the new time.
 */
export async function exportClosedOrders(db: Executor, sandboxId: string, orderIds: string[], simNow: Date): Promise<{ filename: string; csv: string; count: number }> {
  const unique = [...new Set(orderIds)];
  const loaded = await loadClosed(db, sandboxId, unique);
  if (loaded.length === 0) throw new HttpError(400, "Wybierz co najmniej jedno zamknięte zlecenie.");
  if (loaded.length !== unique.length) throw new HttpError(409, "Część wybranych zleceń nie jest już zamknięta. Odśwież listę i spróbuj ponownie.");
  // Oldest first: the order an accountant issues invoices in.
  const rows = loaded.map((l) => l.row).sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0) || a.number.localeCompare(b.number));
  await db
    .update(orders)
    .set({ invoiceExportedAt: simNow })
    .where(and(eq(orders.sandboxId, sandboxId), inArray(orders.id, loaded.map((l) => l.id))));
  return { filename: invoiceCsvFilename(simNow), csv: buildInvoiceCsv(rows), count: rows.length };
}
