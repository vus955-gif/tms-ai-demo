import { and, eq } from "drizzle-orm";
import { driverClientHistory, orders, type OrderStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import { getRoute } from "@/adapters/routing/static-routes";
import { STATUS_LABEL } from "@/domain/order-lifecycle";
import { evaluateCandidate, matchCandidates, type MatchCandidate, type MatchOrder, type MatchResult } from "@/domain/matching";
import { HttpError } from "../http";
import { buildEnv } from "../monitoring/env";
import { loadFleet, type FleetData } from "../monitoring/fleet-data";
import { routeLabel } from "../monitoring/labels";
import { stopsForVehicle, toSimState, type OrderRow } from "../monitoring/state";
import { currentOrderOf } from "../monitoring/views";

export type OrderCard = {
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
  cargoPallets: number;
  cargoKg: number;
  bodyRequired: string | null;
  adrRequired: boolean;
  source: string;
  risk: string | null;
  eta: string | null;
  references: string[];
};

export type DriverLane = {
  driverId: string;
  driverName: string;
  vehicleId: string;
  plates: string;
  trailerPlates: string | null;
  kind: "bus" | "solo" | "tractor";
  capacityPallets: number;
  current: OrderCard | null;
  queue: OrderCard[];
};

export type OrdersBoard = { newOrders: OrderCard[]; drafts: OrderCard[]; lanes: DriverLane[] };

export function orderCard(fleet: FleetData, o: OrderRow): OrderCard {
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
    cargoPallets: o.cargoPallets,
    cargoKg: o.cargoKg,
    bodyRequired: o.bodyRequired,
    adrRequired: o.adrRequired,
    source: o.source,
    risk: o.risk,
    eta: o.etaPredicted?.toISOString() ?? null,
    references: o.references,
  };
}

const QUEUE: OrderStatus[] = ["PRZYPISANE", "WYSLANE", "POTWIERDZONE"];

export async function ordersBoard(db: Executor, sandboxId: string): Promise<OrdersBoard> {
  const fleet = await loadFleet(db, sandboxId);
  const byPickup = (a: OrderRow, b: OrderRow) => a.pickupFrom.getTime() - b.pickupFrom.getTime();
  const lanes: DriverLane[] = fleet.vehicles.map((vehicle) => {
    const driver = fleet.driverByVehicle.get(vehicle.id)!;
    const trailer = fleet.trailerByVehicle.get(vehicle.id);
    const current = currentOrderOf(fleet, vehicle.id);
    const target = fleet.states.get(vehicle.id)?.orderId;
    // A confirmed order the vehicle is already heading for is current work, not queue.
    const moving =
      current && (["ZALADUNEK", "W_DRODZE", "ROZLADUNEK", "DO_ZAMKNIECIA"].includes(current.status) || (current.status === "POTWIERDZONE" && current.id === target))
        ? current
        : undefined;
    const queue = fleet.openOrders.filter((o) => o.driverId === driver.id && QUEUE.includes(o.status) && o.id !== moving?.id).sort(byPickup);
    return {
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      vehicleId: vehicle.id,
      plates: vehicle.plates,
      trailerPlates: trailer?.plates ?? null,
      kind: vehicle.kind,
      capacityPallets: trailer?.capacityPallets ?? vehicle.capacityPallets,
      current: moving ? orderCard(fleet, moving) : null,
      queue: queue.map((o) => orderCard(fleet, o)),
    };
  });
  return {
    newOrders: fleet.openOrders.filter((o) => o.status === "NOWE").sort(byPickup).map((o) => orderCard(fleet, o)),
    drafts: fleet.openOrders.filter((o) => o.status === "SZKIC").sort(byPickup).map((o) => orderCard(fleet, o)),
    lanes,
  };
}

export type MatchView = MatchResult & { plates: string; trailerPlates: string | null; driverName: string; kind: string };

async function candidatesFor(db: Executor, fleet: FleetData, sandboxId: string, clientId: string, simNow: Date): Promise<MatchCandidate[]> {
  const history = await db
    .select()
    .from(driverClientHistory)
    .where(and(eq(driverClientHistory.sandboxId, sandboxId), eq(driverClientHistory.clientId, clientId)));
  return fleet.vehicles.map((vehicle) => {
    const driver = fleet.driverByVehicle.get(vehicle.id)!;
    const trailer = fleet.trailerByVehicle.get(vehicle.id);
    const state = fleet.states.get(vehicle.id)!;
    const stops = stopsForVehicle(fleet.openOrders.filter((o) => o.vehicleId === vehicle.id), fleet.points);
    const sim = toSimState(state, stops, simNow.getTime());
    return {
      vehicleId: vehicle.id,
      driverId: driver.id,
      capacityPallets: trailer?.capacityPallets ?? vehicle.capacityPallets,
      capacityKg: trailer?.capacityKg ?? vehicle.capacityKg,
      body: trailer?.body ?? vehicle.body,
      adr: vehicle.adr || Boolean(trailer?.adr),
      driverAdr: driver.adrCertificate,
      sim,
      env: buildEnv(vehicle, fleet),
      freePointId: stops.length > 0 ? stops[stops.length - 1].pointId : state.pointId,
      historyWithClient: history.find((h) => h.driverId === driver.id)?.completedOrders ?? 0,
      distanceM: (from, to) => (from === to ? 0 : getRoute(from, to).distanceM),
    };
  });
}

function toMatchOrder(fleet: FleetData, o: OrderRow): MatchOrder {
  const handling = (id: string) => fleet.points.get(id)?.handlingMinutes ?? 45;
  return {
    id: o.id,
    clientId: o.clientId,
    pickupPointId: o.pickupPointId,
    deliveryPointId: o.deliveryPointId,
    pickupFromMs: o.pickupFrom.getTime(),
    pickupToMs: o.pickupTo.getTime(),
    deliveryFromMs: o.deliveryFrom.getTime(),
    deliveryToMs: o.deliveryTo.getTime(),
    cargoPallets: o.cargoPallets,
    cargoKg: o.cargoKg,
    bodyRequired: o.bodyRequired,
    adrRequired: o.adrRequired,
    pickupHandlingMin: handling(o.pickupPointId),
    deliveryHandlingMin: handling(o.deliveryPointId),
  };
}

async function loadAssignable(db: Executor, sandboxId: string, orderId: string) {
  const fleet = await loadFleet(db, sandboxId);
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  return { fleet, order };
}

/** "Klocki" for one order: every driver with tier, score and reasons. */
export async function matchOrder(db: Executor, sandboxId: string, orderId: string, simNow: Date): Promise<MatchView[]> {
  const { fleet, order } = await loadAssignable(db, sandboxId, orderId);
  const results = matchCandidates(toMatchOrder(fleet, order), await candidatesFor(db, fleet, sandboxId, order.clientId, simNow));
  return results.map((r) => {
    const vehicle = fleet.vehicles.find((v) => v.id === r.vehicleId)!;
    const driver = fleet.drivers.get(r.driverId)!;
    return {
      ...r,
      plates: vehicle.plates,
      trailerPlates: fleet.trailerByVehicle.get(vehicle.id)?.plates ?? null,
      driverName: `${driver.firstName} ${driver.lastName}`,
      kind: vehicle.kind,
    };
  });
}

/** Rejects an assignment the matching rules exclude (capacity, ADR, windows…). */
export async function assertAssignable(db: Executor, sandboxId: string, orderId: string, driverId: string, simNow: Date) {
  const { fleet, order } = await loadAssignable(db, sandboxId, orderId);
  const candidate = (await candidatesFor(db, fleet, sandboxId, order.clientId, simNow)).find((c) => c.driverId === driverId);
  if (!candidate) throw new HttpError(404, "Nie ma takiego kierowcy.");
  const result = evaluateCandidate(toMatchOrder(fleet, order), candidate);
  if (result.tier === "excluded") throw new HttpError(409, `Tego zlecenia nie można przydzielić: ${result.reasons[0]}.`);
}
