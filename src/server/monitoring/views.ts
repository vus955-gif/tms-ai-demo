import { and, eq, inArray } from "drizzle-orm";
import { alerts, incidents, type AlertAction, type AlertSeverity, type OrderStatus, type VehicleMode } from "@/db/schema";
import type { Executor } from "@/db/types";
import { getRouteByKey } from "@/adapters/routing/static-routes";
import { drivingAllowance } from "@/domain/driving-time";
import { STATUS_LABEL } from "@/domain/order-lifecycle";
import type { RiskState } from "@/domain/risk";
import { distanceFraction } from "@/simulation/geo";
import { loadFleet, type FleetData } from "./fleet-data";
import { routeLabel } from "./labels";
import type { OrderRow } from "./state";

export const MODE_LABEL: Record<VehicleMode, string> = {
  driving: "jazda",
  break: "przerwa",
  daily_rest: "odpoczynek dobowy",
  handling: "załadunek / rozładunek",
  waiting: "czeka na okno",
  stopped: "postój",
  idle: "wolny",
};

export type OrderSummary = {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  clientName: string;
  routeLabel: string;
  pickupFrom: string;
  pickupTo: string;
  deliveryFrom: string;
  deliveryTo: string;
  eta: string | null;
  arrivedDeliveryAt: string | null;
  unloadedAt: string | null;
};

export type VehicleView = {
  id: string;
  plates: string;
  trailerPlates: string | null;
  kind: "bus" | "solo" | "tractor";
  driverId: string;
  driverName: string;
  mode: VehicleMode;
  modeLabel: string;
  modeUntil: string | null;
  risk: RiskState;
  lng: number;
  lat: number;
  lastReportAt: string | null;
  order: OrderSummary | null;
  legLabel: string | null;
  progress: number | null;
  subjectTo561: boolean;
  /** Minutes of driving left today/until a break; null when Regulation 561 does not apply. */
  drivingLeftMin: number | null;
  untilBreakMin: number | null;
  continuousMin: number;
  dailyMin: number;
  rerouted: boolean;
  pointCity: string | null;
};

export type AlertView = {
  id: string;
  kind: string;
  severity: AlertSeverity;
  status: "open" | "acknowledged" | "resolved";
  title: string;
  body: string;
  bodySource: "ai" | "template";
  actions: AlertAction[];
  vehicleId: string | null;
  orderId: string | null;
  createdSim: string;
  alternativeRouteKey: string | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function orderSummary(fleet: FleetData, o: OrderRow): OrderSummary {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    statusLabel: STATUS_LABEL[o.status],
    clientName: fleet.clients.get(o.clientId)?.name ?? "",
    routeLabel: routeLabel(fleet, o),
    pickupFrom: o.pickupFrom.toISOString(),
    pickupTo: o.pickupTo.toISOString(),
    deliveryFrom: o.deliveryFrom.toISOString(),
    deliveryTo: o.deliveryTo.toISOString(),
    eta: iso(o.etaPredicted),
    arrivedDeliveryAt: iso(o.arrivedDeliveryAt),
    unloadedAt: iso(o.unloadedAt),
  };
}

/** The order a vehicle is working on (moving first, then the latest delivered). */
export function currentOrderOf(fleet: FleetData, vehicleId: string): OrderRow | undefined {
  const own = fleet.openOrders.filter((o) => o.vehicleId === vehicleId);
  const moving = own.find((o) => ["ZALADUNEK", "W_DRODZE"].includes(o.status)) ?? own.find((o) => o.status === "POTWIERDZONE");
  return moving ?? own.filter((o) => o.status === "ROZLADUNEK" || o.status === "DO_ZAMKNIECIA").sort((a, b) => (b.arrivedDeliveryAt?.getTime() ?? 0) - (a.arrivedDeliveryAt?.getTime() ?? 0))[0];
}

export function vehicleViews(fleet: FleetData): VehicleView[] {
  return fleet.vehicles.map((vehicle) => {
    const state = fleet.states.get(vehicle.id)!;
    const driver = fleet.drivers.get(state.driverId);
    const trailer = fleet.trailerByVehicle.get(vehicle.id);
    const order = currentOrderOf(fleet, vehicle.id);
    const moving = order && ["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"].includes(order.status);
    const allowance = drivingAllowance(
      { continuousMin: state.continuousMin, dailyMin: state.dailyMin, splitFirstPart: state.splitFirstPart, extensionsUsed: state.extensionsUsed },
      vehicle.subjectTo561,
    );
    const progress = state.routeKey && state.mode !== "idle" ? distanceFraction(getRouteByKey(state.routeKey), state.progressS) : null;
    const pointCity = state.pointId ? (fleet.points.get(state.pointId)?.city ?? null) : null;
    return {
      id: vehicle.id,
      plates: vehicle.plates,
      trailerPlates: trailer?.plates ?? null,
      kind: vehicle.kind,
      driverId: state.driverId,
      driverName: driver ? `${driver.firstName} ${driver.lastName}` : "",
      mode: state.mode,
      modeLabel: MODE_LABEL[state.mode],
      modeUntil: iso(state.modeUntil),
      risk: moving ? ((order!.risk ?? "green") as RiskState) : "gray",
      lng: state.lastReportLng ?? 0,
      lat: state.lastReportLat ?? 0,
      lastReportAt: iso(state.lastReportAt),
      order: order ? orderSummary(fleet, order) : null,
      legLabel: state.legPurpose === "to_pickup" ? "do załadunku" : state.legPurpose === "to_delivery" ? "do rozładunku" : null,
      progress,
      subjectTo561: vehicle.subjectTo561,
      drivingLeftMin: Number.isFinite(allowance.remainingMin) ? allowance.remainingMin : null,
      untilBreakMin: Number.isFinite(allowance.untilBreakMin) ? allowance.untilBreakMin : null,
      continuousMin: state.continuousMin,
      dailyMin: state.dailyMin,
      rerouted: Boolean(state.reroutedFrom),
      pointCity,
    };
  });
}

export async function alertViews(db: Executor, sandboxId: string): Promise<AlertView[]> {
  const rows = await db
    .select({ alert: alerts, alternativeRouteKey: incidents.alternativeRouteKey })
    .from(alerts)
    .leftJoin(incidents, and(eq(incidents.sandboxId, alerts.sandboxId), eq(incidents.id, alerts.incidentId)))
    .where(and(eq(alerts.sandboxId, sandboxId), inArray(alerts.status, ["open", "acknowledged"])));
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return rows
    .map(({ alert: a, alternativeRouteKey }) => ({
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      status: a.status,
      title: a.title,
      body: a.body,
      bodySource: a.bodySource,
      actions: a.actions,
      vehicleId: a.vehicleId,
      orderId: a.orderId,
      createdSim: a.createdSim.toISOString(),
      alternativeRouteKey: alternativeRouteKey ?? null,
    }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.createdSim.localeCompare(a.createdSim));
}

export async function monitoringSnapshot(db: Executor, sandboxId: string) {
  const fleet = await loadFleet(db, sandboxId);
  return { fleet: vehicleViews(fleet), alerts: await alertViews(db, sandboxId) };
}
