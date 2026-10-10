import { and, desc, eq, gte } from "drizzle-orm";
import { driverActivities, vehicleStates } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { getRouteByKey, hasRouteKey } from "@/adapters/routing/static-routes";
import { nearestProgressS, positionAt, sliceCoordinates } from "@/simulation/geo";
import { predictArrival } from "@/simulation/vehicle-sim";
import { HttpError } from "../http";
import { buildEnv, isActive } from "./env";
import { loadFleet } from "./fleet-data";
import { stopsForVehicle, toSimState } from "./state";
import { vehicleViews, type VehicleView } from "./views";

export type Breakdown = {
  eta: string;
  drivingMin: number;
  breakMin: number;
  restMin: number;
  otherWorkMin: number;
  breaks: number;
  restRequired: boolean;
  firstBreakAfterDrivingMin: number | null;
};

export type VehicleDetail = {
  vehicle: VehicleView;
  route: { driven: [number, number][]; remaining: [number, number][]; destinationCity: string | null } | null;
  alternatives: { key: string; label: string; coordinates: [number, number][]; eta: string | null }[];
  breakdown: Breakdown | null;
  activities: { type: string; start: string; end: string | null }[];
};

/** Everything the detail panel shows about one vehicle, computed at the world's current time. */
export async function vehicleDetail(db: Executor, sandboxId: string, vehicleId: string, simNow: Date): Promise<VehicleDetail> {
  const fleet = await loadFleet(db, sandboxId);
  const vehicle = fleet.vehicles.find((v) => v.id === vehicleId);
  const state = fleet.states.get(vehicleId);
  if (!vehicle || !state) throw new HttpError(404, "Nie ma takiego pojazdu.");
  const view = vehicleViews(fleet).find((v) => v.id === vehicleId)!;
  const stops = stopsForVehicle(fleet.openOrders.filter((o) => o.vehicleId === vehicleId), fleet.points);
  const sim = toSimState(state, stops, simNow.getTime());
  const env = buildEnv(vehicle, fleet);

  let route: VehicleDetail["route"] = null;
  if (state.routeKey && state.mode !== "idle") {
    const r = getRouteByKey(state.routeKey);
    route = {
      driven: sliceCoordinates(r, 0, state.progressS),
      remaining: sliceCoordinates(r, state.progressS, r.durationS),
      destinationCity: fleet.points.get(r.to)?.city ?? null,
    };
  }

  let breakdown: Breakdown | null = null;
  const target = stops.find((s) => s.purpose === "delivery");
  if (target) {
    const p = predictArrival(sim, env, (s) => s.orderId === target.orderId && s.purpose === "delivery");
    if (p) {
      breakdown = {
        eta: new Date(p.arrivalMs).toISOString(),
        drivingMin: p.drivingMin,
        breakMin: p.breakMin,
        restMin: p.restMin,
        otherWorkMin: p.handlingMin,
        breaks: p.breaks,
        restRequired: p.restRequired,
        firstBreakAfterDrivingMin: p.firstBreakAfterDrivingMin,
      };
    }
  }

  const alternatives: VehicleDetail["alternatives"] = [];
  if (state.routeKey && target) {
    const current = getRouteByKey(state.routeKey);
    for (const incident of fleet.incidents) {
      const key = incident.alternativeRouteKey;
      if (!key || !isActive(incident, simNow.getTime()) || key === state.routeKey || !hasRouteKey(key)) continue;
      const alt = getRouteByKey(key);
      if (alt.to !== current.to) continue;
      const here = positionAt(current, state.progressS);
      const from = nearestProgressS(alt, here.lng, here.lat);
      const p = predictArrival({ ...sim, routeKey: key, progressS: from }, env, (s) => s.orderId === target.orderId && s.purpose === "delivery");
      alternatives.push({
        key,
        label: `Objazd: ${incident.title}`,
        coordinates: sliceCoordinates(alt, from, alt.durationS),
        eta: p ? new Date(p.arrivalMs).toISOString() : null,
      });
    }
  }

  const since = new Date(simNow.getTime() - 16 * 3_600_000);
  const acts = await db
    .select()
    .from(driverActivities)
    .where(and(eq(driverActivities.sandboxId, sandboxId), eq(driverActivities.driverId, state.driverId), gte(driverActivities.startSim, since)))
    .orderBy(desc(driverActivities.startSim))
    .limit(40);

  return {
    vehicle: view,
    route,
    alternatives,
    breakdown,
    activities: acts.map((a) => ({ type: a.type, start: a.startSim.toISOString(), end: a.endSim?.toISOString() ?? null })),
  };
}

/** Switches a vehicle onto the alternative route of an active incident (same destination). */
export async function applyReroute(db: Db, sandboxId: string, vehicleId: string, routeKey: string, simNow?: Date) {
  const fleet = await loadFleet(db, sandboxId);
  const state = fleet.states.get(vehicleId);
  if (!state || !state.routeKey || state.mode === "idle") throw new HttpError(409, "Pojazd nie jest w trasie.");
  const at = (simNow ?? state.lastReportAt ?? new Date()).getTime();
  const offered = fleet.incidents.some((i) => i.alternativeRouteKey === routeKey && isActive(i, at));
  if (!offered) throw new HttpError(409, "Ten objazd nie jest teraz dostępny.");
  if (!hasRouteKey(routeKey)) throw new HttpError(404, "Nie ma takiej trasy objazdu.");
  const current = getRouteByKey(state.routeKey);
  const alt = getRouteByKey(routeKey);
  if (alt.to !== current.to) throw new HttpError(409, "Objazd prowadzi do innego celu niż obecna trasa.");
  const here = positionAt(current, state.progressS);
  await db
    .update(vehicleStates)
    .set({ routeKey, progressS: nearestProgressS(alt, here.lng, here.lat), reroutedFrom: state.routeKey })
    .where(and(eq(vehicleStates.sandboxId, sandboxId), eq(vehicleStates.vehicleId, vehicleId)));
}
