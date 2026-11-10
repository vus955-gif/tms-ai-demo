import { and, eq, inArray } from "drizzle-orm";
import { clients, drivers, orders, orderStatusChanges, points, type OrderStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import { historyEntries, historySummary, type HistoryEntry, type HistorySummary } from "@/domain/order-history";
import { STATUS_LABEL } from "@/domain/order-lifecycle";
import { HttpError } from "../http";

export type OrderHistoryView = {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  clientName: string;
  routeLabel: string;
  /** The driver the order is with now; earlier drivers are named only in the reasons of the changes. */
  driverName: string | null;
  entries: HistoryEntry[];
  summary: HistorySummary;
};

/** The life of one order, oldest change first — every status change the system recorded, with who made it and why. */
export async function orderHistory(db: Executor, sandboxId: string, orderId: string): Promise<OrderHistoryView> {
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  const [clientRows, pointRows, driverRows, changes] = await Promise.all([
    db.select({ name: clients.name }).from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, order.clientId))),
    db
      .select({ id: points.id, city: points.city })
      .from(points)
      .where(and(eq(points.sandboxId, sandboxId), inArray(points.id, [order.pickupPointId, order.deliveryPointId]))),
    order.driverId
      ? db
          .select({ firstName: drivers.firstName, lastName: drivers.lastName })
          .from(drivers)
          .where(and(eq(drivers.sandboxId, sandboxId), eq(drivers.id, order.driverId)))
      : Promise.resolve([]),
    db
      .select()
      .from(orderStatusChanges)
      .where(and(eq(orderStatusChanges.sandboxId, sandboxId), eq(orderStatusChanges.orderId, orderId))),
  ]);
  const city = (id: string) => pointRows.find((p) => p.id === id)?.city ?? id;
  const driver = driverRows[0];
  const entries = historyEntries(changes);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    statusLabel: STATUS_LABEL[order.status],
    clientName: clientRows[0]?.name ?? "",
    routeLabel: `${city(order.pickupPointId)} → ${city(order.deliveryPointId)}`,
    driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
    entries,
    summary: historySummary(entries),
  };
}
