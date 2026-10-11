import { and, eq } from "drizzle-orm";
import { drivers, orders, trackingLinks } from "@/db/schema";
import type { Executor } from "@/db/types";
import { getRouteByKey } from "@/adapters/routing/static-routes";
import { clientView, leaksDriverData, type ClientView } from "@/domain/client-view";
import { distanceFraction } from "@/simulation/geo";
import { config } from "../config";
import { loadFleet } from "../monitoring/fleet-data";

/** Builds the client-safe view of one order from the live fleet state. */
export async function buildClientView(db: Executor, sandboxId: string, orderId: string): Promise<ClientView | null> {
  const fleet = await loadFleet(db, sandboxId);
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) return null;
  const vehicle = order.vehicleId ? fleet.vehicles.find((v) => v.id === order.vehicleId) : undefined;
  const state = order.vehicleId ? fleet.states.get(order.vehicleId) : undefined;
  const onDeliveryLeg = state && state.orderId === order.id && state.legPurpose === "to_delivery" && state.routeKey;
  const [link] = await db
    .select({ token: trackingLinks.token })
    .from(trackingLinks)
    .where(and(eq(trackingLinks.sandboxId, sandboxId), eq(trackingLinks.orderId, order.id), eq(trackingLinks.revoked, false)));
  const view = clientView({
    number: order.number,
    status: order.status,
    plates: vehicle?.plates ?? null,
    trailerPlates: order.vehicleId ? (fleet.trailerByVehicle.get(order.vehicleId)?.plates ?? null) : null,
    eta: order.etaPredicted,
    pickupFrom: order.pickupFrom,
    pickupTo: order.pickupTo,
    pickupCity: fleet.points.get(order.pickupPointId)?.city ?? "",
    deliveryFrom: order.deliveryFrom,
    deliveryTo: order.deliveryTo,
    deliveryLegProgress: onDeliveryLeg ? distanceFraction(getRouteByKey(state.routeKey!), state.progressS) : null,
    references: order.references,
    deliveryCity: fleet.points.get(order.deliveryPointId)?.city ?? "",
  });
  return link ? { ...view, trackingUrl: `${config.appUrl}/sledzenie/${link.token}` } : view;
}

/** True when a client draft mentions any driver of this world. */
export async function draftLeaksDriverData(db: Executor, sandboxId: string, text: string): Promise<boolean> {
  const rows = await db.select({ firstName: drivers.firstName, lastName: drivers.lastName, phone: drivers.phone }).from(drivers).where(eq(drivers.sandboxId, sandboxId));
  return leaksDriverData(text, rows);
}
