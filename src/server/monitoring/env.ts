import { TZDate } from "@date-fns/tz";
import type { incidents, points, vehicles } from "@/db/schema";
import { getRouteByKey } from "@/adapters/routing/static-routes";
import { WARSAW } from "@/simulation/clock";
import { haversineM } from "@/simulation/geo";
import { routeKey } from "@/simulation/route-geometry";
import type { SimEnv } from "@/simulation/vehicle-sim";

export type PointRow = typeof points.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;

/**
 * OSRM computes car travel times; trucks are limited to 80 km/h, so their
 * trips take longer. Multipliers on the base durations.
 */
export const SPEED_FACTOR: Record<VehicleRow["kind"], number> = { tractor: 1.2, solo: 1.15, bus: 1.08 };

/** Time-of-day traffic on travel time (spec §7.2): morning and afternoon peaks. */
export function trafficFactor(atMs: number): number {
  const hour = new TZDate(atMs, WARSAW).getHours();
  if (hour >= 7 && hour < 9) return 1.2;
  if (hour >= 15 && hour < 18) return 1.25;
  return 1;
}

export function isActive(incident: IncidentRow, atMs: number): boolean {
  return atMs >= incident.startSim.getTime() && (incident.endSim === null || atMs < incident.endSim.getTime());
}

/** Combined speed factor of traffic incidents covering a position at a time. */
export function areaSpeedFrom(list: IncidentRow[]) {
  const area = list.filter((i) => i.kind === "traffic_accident" && i.lat !== null && i.lng !== null && i.radiusM);
  return (lng: number, lat: number, atMs: number): number => {
    let factor = 1;
    for (const i of area) {
      if (isActive(i, atMs) && haversineM(lng, lat, i.lng!, i.lat!) <= i.radiusM!) factor *= i.speedFactor ?? 1;
    }
    return factor;
  };
}

export function forcedStopsFor(vehicleId: string, list: IncidentRow[]) {
  return list
    .filter((i) => (i.kind === "breakdown" || i.kind === "road_check") && i.vehicleId === vehicleId && i.endSim)
    .map((i) => ({ startMs: i.startSim.getTime(), endMs: i.endSim!.getTime() }));
}

export type FleetEnvData = { points: Map<string, PointRow>; incidents: IncidentRow[] };

export function buildEnv(vehicle: VehicleRow, data: FleetEnvData, opts: { ignoreIncidents?: boolean } = {}): SimEnv {
  return {
    subjectTo561: vehicle.subjectTo561,
    speedFactor: SPEED_FACTOR[vehicle.kind],
    getRoute: (key) => getRouteByKey(key),
    routeKeyBetween: (from, to) => routeKey(from, to),
    pointLngLat: (id) => {
      const p = data.points.get(id);
      if (!p) throw new Error(`Unknown point ${id}`);
      return [p.lng, p.lat];
    },
    trafficFactor,
    areaSpeed: opts.ignoreIncidents ? () => 1 : areaSpeedFrom(data.incidents),
    forcedStops: opts.ignoreIncidents ? [] : forcedStopsFor(vehicle.id, data.incidents),
  };
}
