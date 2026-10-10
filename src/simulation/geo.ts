import type { RoutePoint, StoredRoute } from "./route-geometry";

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Index of the last point whose value at `field` is <= value (binary search). */
function segmentIndex(points: RoutePoint[], value: number, field: 2 | 3): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][field] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

export type RoutePosition = { lng: number; lat: number; distanceM: number; bearing: number };

/** Position after `progressS` base seconds along the route (clamped to its ends). */
export function positionAt(route: StoredRoute, progressS: number): RoutePosition {
  const pts = route.points;
  const s = Math.min(Math.max(progressS, 0), route.durationS);
  const i = segmentIndex(pts, s, 3);
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  const span = b[3] - a[3];
  const f = span > 0 ? (s - a[3]) / span : 0;
  return {
    lng: a[0] + (b[0] - a[0]) * f,
    lat: a[1] + (b[1] - a[1]) * f,
    distanceM: a[2] + (b[2] - a[2]) * f,
    bearing: bearingDeg(a[0], a[1], b[0], b[1]),
  };
}

export function bearingDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Base seconds along the route of the point closest to (lng, lat). */
export function nearestProgressS(route: StoredRoute, lng: number, lat: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const p of route.points) {
    const d = haversineM(lng, lat, p[0], p[1]);
    if (d < bestD) {
      bestD = d;
      best = p[3];
    }
  }
  return best;
}

/** Fraction (0–1) of the route distance covered at `progressS`. */
export function distanceFraction(route: StoredRoute, progressS: number): number {
  return route.distanceM > 0 ? positionAt(route, progressS).distanceM / route.distanceM : 1;
}

/** Route coordinates from `fromS` to `toS` (for drawing driven / remaining parts). */
export function sliceCoordinates(route: StoredRoute, fromS: number, toS: number): [number, number][] {
  const start = positionAt(route, fromS);
  const end = positionAt(route, toS);
  const inner = route.points.filter((p) => p[3] > fromS && p[3] < toS).map((p) => [p[0], p[1]] as [number, number]);
  return [[start.lng, start.lat], ...inner, [end.lng, end.lat]];
}
