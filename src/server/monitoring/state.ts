import type { orders, vehicleStates } from "@/db/schema";
import { MOVING_STATUSES } from "@/domain/order-lifecycle";
import type { SimState, Stop } from "@/simulation/vehicle-sim";
import type { PointRow } from "./env";

export type OrderRow = typeof orders.$inferSelect;
export type VehicleStateRow = typeof vehicleStates.$inferSelect;

const RANK: Partial<Record<OrderRow["status"], number>> = { ROZLADUNEK: 0, W_DRODZE: 1, ZALADUNEK: 1, POTWIERDZONE: 2 };

/** Upcoming stops of one vehicle, derived from its confirmed orders. */
export function stopsForVehicle(vehicleOrders: OrderRow[], points: Map<string, PointRow>): Stop[] {
  // Unloading in progress keeps its delivery stop until the vehicle leaves.
  const active = vehicleOrders
    .filter((o) => MOVING_STATUSES.includes(o.status) || (o.status === "ROZLADUNEK" && o.unloadedAt === null))
    .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.pickupFrom.getTime() - b.pickupFrom.getTime());
  const stops: Stop[] = [];
  for (const o of active) {
    const handling = (id: string) => points.get(id)?.handlingMinutes ?? 45;
    if (o.status === "POTWIERDZONE" || o.status === "ZALADUNEK") {
      stops.push({
        orderId: o.id,
        purpose: "pickup",
        pointId: o.pickupPointId,
        windowFromMs: o.pickupFrom.getTime(),
        windowToMs: o.pickupTo.getTime(),
        handlingMin: handling(o.pickupPointId),
      });
    }
    stops.push({
      orderId: o.id,
      purpose: "delivery",
      pointId: o.deliveryPointId,
      windowFromMs: o.deliveryFrom.getTime(),
      windowToMs: o.deliveryTo.getTime(),
      handlingMin: handling(o.deliveryPointId),
    });
  }
  return stops;
}

export function toSimState(row: VehicleStateRow, stops: Stop[], atMs: number): SimState {
  return {
    atMs,
    mode: row.mode,
    modeUntilMs: row.modeUntil?.getTime() ?? null,
    resumeMode: row.resumeMode,
    routeKey: row.routeKey,
    progressS: row.progressS,
    pointId: row.pointId,
    stops,
    clock: {
      continuousMin: row.continuousMin,
      dailyMin: row.dailyMin,
      splitFirstPart: row.splitFirstPart,
      extensionsUsed: row.extensionsUsed,
    },
    pendingExtraMin: row.pendingExtraMin,
  };
}

export function fromSimState(state: SimState): Partial<VehicleStateRow> {
  const current = state.stops[0];
  return {
    mode: state.mode,
    modeUntil: state.modeUntilMs === null ? null : new Date(state.modeUntilMs),
    resumeMode: state.resumeMode,
    routeKey: state.routeKey,
    progressS: state.progressS,
    pointId: state.pointId,
    legPurpose: current ? (current.purpose === "pickup" ? "to_pickup" : "to_delivery") : null,
    orderId: current?.orderId ?? null,
    continuousMin: state.clock.continuousMin,
    dailyMin: state.clock.dailyMin,
    splitFirstPart: state.clock.splitFirstPart,
    extensionsUsed: state.clock.extensionsUsed,
    pendingExtraMin: state.pendingExtraMin,
  };
}

export { beginNextLeg } from "@/simulation/vehicle-sim";
