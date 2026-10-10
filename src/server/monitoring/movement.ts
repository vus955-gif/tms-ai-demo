import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { driverActivities, orders, vehicleStates } from "@/db/schema";
import type { Executor } from "@/db/types";
import { advance, type ActivitySegment, type SimEvent, type SimState } from "@/simulation/vehicle-sim";
import { registerTickPhase, type TickContext } from "../tick/registry";
import { transitionOrder } from "../orders/transition";
import { buildEnv, type VehicleRow } from "./env";
import { loadFleet, type FleetData } from "./fleet-data";
import { beginNextLeg, fromSimState, stopsForVehicle, toSimState, type OrderRow } from "./state";

export type MovementListener = (
  ctx: TickContext,
  info: { vehicle: VehicleRow; event: SimEvent; order: OrderRow | undefined; fleet: FleetData },
) => Promise<void>;

const listeners: MovementListener[] = [];
/** Later stages hook into arrivals and departures (e.g. CMR reminders after unloading). */
export function onMovement(listener: MovementListener) {
  listeners.push(listener);
}

export const FLEET_CACHE = "fleet";
export const SIM_STATES_CACHE = "simStates";

/** Extends the driver's open activity or closes it and opens a new one. Returns the open activity id. */
export async function persistSegments(
  db: Executor,
  sandboxId: string,
  driverId: string,
  currentId: string | null,
  segments: ActivitySegment[],
): Promise<string | null> {
  if (segments.length === 0) return currentId;
  let openId = currentId;
  let openType: string | null = null;
  if (openId) {
    const [row] = await db
      .select({ type: driverActivities.type, endSim: driverActivities.endSim })
      .from(driverActivities)
      .where(and(eq(driverActivities.sandboxId, sandboxId), eq(driverActivities.id, openId)));
    openType = row && row.endSim === null ? row.type : null;
    if (!row || row.endSim !== null) openId = null;
  }
  for (const seg of segments) {
    if (openId && openType === seg.type) continue;
    if (openId) {
      await db
        .update(driverActivities)
        .set({ endSim: new Date(seg.startMs) })
        .where(and(eq(driverActivities.sandboxId, sandboxId), eq(driverActivities.id, openId)));
    }
    openId = randomUUID();
    openType = seg.type;
    await db.insert(driverActivities).values({
      sandboxId,
      id: openId,
      driverId,
      type: seg.type,
      startSim: new Date(seg.startMs),
      endSim: null,
      source: "plan",
    });
  }
  return openId;
}

async function applyEvent(ctx: TickContext, fleet: FleetData, vehicle: VehicleRow, event: SimEvent) {
  if (event.type !== "arrived" && event.type !== "departed") return;
  const order = fleet.openOrders.find((o) => o.id === event.stop.orderId);
  if (!order) return;
  const at = new Date(event.atMs);
  const sid = ctx.sandbox.id;
  if (event.type === "arrived" && event.stop.purpose === "pickup" && order.status === "POTWIERDZONE") {
    await transitionOrder(ctx.tx, sid, order, "ZALADUNEK", "system", "Przyjazd na załadunek (GPS)", at, { arrivedPickupAt: at });
    order.status = "ZALADUNEK";
  } else if (event.type === "departed" && event.stop.purpose === "pickup" && order.status === "ZALADUNEK") {
    await transitionOrder(ctx.tx, sid, order, "W_DRODZE", "system", "Wyjazd z załadunku (GPS)", at, { departedPickupAt: at });
    order.status = "W_DRODZE";
  } else if (event.type === "arrived" && event.stop.purpose === "delivery" && order.status === "W_DRODZE") {
    await transitionOrder(ctx.tx, sid, order, "ROZLADUNEK", "system", "Przyjazd na rozładunek (GPS)", at, { arrivedDeliveryAt: at });
    order.status = "ROZLADUNEK";
  } else if (event.type === "departed" && event.stop.purpose === "delivery") {
    await ctx.tx
      .update(orders)
      .set({ unloadedAt: at })
      .where(and(eq(orders.sandboxId, sid), eq(orders.id, order.id)));
    order.unloadedAt = at;
  }
  for (const listener of listeners) await listener(ctx, { vehicle, event, order, fleet });
}

/** Tick phase: every vehicle drives, rests, loads and unloads up to the tick's time. */
export async function movementPhase(ctx: TickContext) {
  const fleet = await loadFleet(ctx.tx, ctx.sandbox.id);
  ctx.cache.set(FLEET_CACHE, fleet);
  const simStates = new Map<string, SimState>();
  const fromMs = ctx.previousSim.getTime();
  const toMs = ctx.simNow.getTime();

  for (const vehicle of fleet.vehicles) {
    const row = fleet.states.get(vehicle.id);
    if (!row) continue;
    const env = buildEnv(vehicle, fleet);
    const stops = stopsForVehicle(
      fleet.openOrders.filter((o) => o.vehicleId === vehicle.id),
      fleet.points,
    );
    let sim = beginNextLeg(toSimState(row, stops, fromMs), env.routeKeyBetween);
    if (toMs > fromMs) {
      const result = advance(sim, toMs, env, { reportPhaseS: row.reportPhaseS });
      for (const event of result.events) await applyEvent(ctx, fleet, vehicle, event);
      const activityId = await persistSegments(ctx.tx, ctx.sandbox.id, row.driverId, row.currentActivityId, result.segments);
      const last = result.reports[result.reports.length - 1];
      sim = result.state;
      const patch = {
        ...fromSimState(sim),
        currentActivityId: activityId,
        ...(last
          ? { lastReportAt: new Date(last.atMs), lastReportLng: last.lng, lastReportLat: last.lat, lastReportProgressS: last.progressS }
          : {}),
      };
      await ctx.tx
        .update(vehicleStates)
        .set(patch)
        .where(and(eq(vehicleStates.sandboxId, ctx.sandbox.id), eq(vehicleStates.vehicleId, vehicle.id)));
      Object.assign(row, patch);
    }
    simStates.set(vehicle.id, sim);
  }
  ctx.cache.set(SIM_STATES_CACHE, simStates);
}

registerTickPhase("movement", movementPhase);
