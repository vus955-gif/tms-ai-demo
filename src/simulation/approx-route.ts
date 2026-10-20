import { roadDistanceM, roadDurationS } from "@/domain/road-estimate";
import { haversineM } from "./geo";
import { routeKey, type RoutePoint, type StoredRoute } from "./route-geometry";

/** A route made up from coordinates when no road route exists; shown to people as "trasa przybliżona". */
export type ApproxRoute = StoredRoute & { approx: true };

const STEP_M = 2000;
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * Straight line between two points (interpolated every ~2 km so vehicles move
 * smoothly on the map), with road distance and time estimated from the
 * calibrated circuity and distance-dependent speed. Deterministic: the same points give the same route.
 */
export function approximateRoute(fromId: string, toId: string, from: [number, number], to: [number, number]): ApproxRoute {
  const straight = haversineM(from[0], from[1], to[0], to[1]);
  const distanceM = Math.max(Math.round(roadDistanceM(straight)), 1);
  const durationS = Math.max(Math.round(roadDurationS(straight)), 1);
  const steps = Math.max(1, Math.ceil(straight / STEP_M));
  const points: RoutePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    points.push([round5(from[0] + (to[0] - from[0]) * f), round5(from[1] + (to[1] - from[1]) * f), Math.round(distanceM * f), Math.round(durationS * f)]);
  }
  return { key: routeKey(fromId, toId), from: fromId, to: toId, distanceM, durationS, points, approx: true };
}

export function isApproxRoute(route: StoredRoute): route is ApproxRoute {
  return (route as Partial<ApproxRoute>).approx === true;
}
