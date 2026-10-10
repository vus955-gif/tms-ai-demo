import type { FleetData } from "./fleet-data";
import type { OrderRow } from "./state";

export function routeLabel(fleet: Pick<FleetData, "points">, order: Pick<OrderRow, "pickupPointId" | "deliveryPointId">): string {
  const city = (id: string) => fleet.points.get(id)?.city ?? id;
  return `${city(order.pickupPointId)} → ${city(order.deliveryPointId)}`;
}
