/** [lng, lat, cumulative distance in m, cumulative duration in s] */
export type RoutePoint = [number, number, number, number];

export type StoredRoute = {
  key: string;
  from: string;
  to: string;
  distanceM: number;
  durationS: number;
  points: RoutePoint[];
};

export function routeKey(from: string, to: string): string {
  return `${from}__${to}`;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** Build a compact route: keeps the endpoints and roughly one point per `stepM` metres. */
export function buildStoredRoute(input: {
  from: string;
  to: string;
  coords: [number, number][];
  segDist: number[];
  segDur: number[];
  stepM: number;
}): StoredRoute {
  const { from, to, coords, segDist, segDur, stepM } = input;
  if (coords.length < 2) throw new Error(`Route ${from} → ${to} has fewer than 2 points`);
  const points: RoutePoint[] = [];
  let cumDist = 0;
  let cumDur = 0;
  let lastKept = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      cumDist += segDist[i - 1] ?? 0;
      cumDur += segDur[i - 1] ?? 0;
    }
    const isLast = i === coords.length - 1;
    if (i === 0 || isLast || cumDist - lastKept >= stepM) {
      points.push([round5(coords[i][0]), round5(coords[i][1]), Math.round(cumDist), Math.round(cumDur)]);
      lastKept = cumDist;
    }
  }
  const last = points[points.length - 1];
  return { key: routeKey(from, to), from, to, distanceM: last[2], durationS: last[3], points };
}

/** Approximate the opposite direction by walking the same geometry backwards. */
export function reverseStoredRoute(route: StoredRoute): StoredRoute {
  const points: RoutePoint[] = [...route.points]
    .reverse()
    .map(([lng, lat, d, t]) => [lng, lat, route.distanceM - d, route.durationS - t]);
  return { ...route, key: routeKey(route.to, route.from), from: route.to, to: route.from, points };
}
