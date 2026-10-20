import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { approximateRoute } from "@/simulation/approx-route";
import { routeKey, type StoredRoute } from "@/simulation/route-geometry";

/** Precomputed routes (© OpenStreetMap contributors, ODbL; routing by OSRM). */
export const ROUTES_DIR = path.join(process.cwd(), "data", "routes");

/** Route keys are ids joined by "__" — nothing that could leave the routes directory. */
export const ROUTE_KEY_RE = /^[a-z0-9-]+__[a-z0-9-]+$/i;

const cache = new Map<string, StoredRoute>();
/** Approximate routes are cheap to rebuild but used in tight simulation loops: keep the most recent ones only. */
const approxCache = new Map<string, StoredRoute>();
const MAX_APPROX = 3000;

export class MissingRouteError extends Error {
  constructor(readonly key: string) {
    super(`No precomputed route "${key}". Run: npm run routes:precompute`);
  }
}

function fileFor(key: string, dir: string): string | null {
  if (!ROUTE_KEY_RE.test(key)) return null;
  const base = path.resolve(dir);
  const file = path.resolve(base, `${key}.json`);
  return file.startsWith(base + path.sep) ? file : null;
}

/**
 * Coordinates of points, registered whenever a world's points are loaded. Points added in the app
 * have ids unique across all worlds, so a route cached for them never belongs to another world.
 */
const coords = new Map<string, [number, number]>();
const MAX_COORDS = 20_000;

export function registerPointCoords(list: { id: string; lng: number; lat: number }[]) {
  for (const p of list) {
    if (coords.size >= MAX_COORDS && !coords.has(p.id)) coords.clear();
    coords.set(p.id, [p.lng, p.lat]);
  }
}

/** A straight-line estimate when no road route was precomputed, e.g. for a point added in the app. */
function approximateFor(key: string): StoredRoute | null {
  if (!ROUTE_KEY_RE.test(key)) return null;
  const [from, to] = key.split("__");
  const a = coords.get(from);
  const b = coords.get(to);
  if (!a || !b) return null;
  return approximateRoute(from, to, a, b);
}

export function getRouteByKey(key: string, dir = ROUTES_DIR): StoredRoute {
  const cached = cache.get(key) ?? approxCache.get(key);
  if (cached) return cached;
  const file = fileFor(key, dir);
  if (file && existsSync(/*turbopackIgnore: true*/ file)) {
    const route = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as StoredRoute;
    cache.set(key, route);
    return route;
  }
  const approx = approximateFor(key);
  if (!approx) throw new MissingRouteError(key);
  if (approxCache.size >= MAX_APPROX) approxCache.delete(approxCache.keys().next().value!);
  approxCache.set(key, approx);
  return approx;
}

/** A road route or, for points added in the app, an approximate one (see `isApproxRoute`). */
export function canRouteKey(key: string, dir = ROUTES_DIR): boolean {
  if (hasRouteKey(key, dir)) return true;
  const [from, to] = key.split("__");
  return ROUTE_KEY_RE.test(key) && coords.has(from) && coords.has(to);
}

export function getRoute(from: string, to: string, dir = ROUTES_DIR): StoredRoute {
  return getRouteByKey(routeKey(from, to), dir);
}

/** A precomputed road route exists (approximate routes do not count). */
export function hasRouteKey(key: string, dir = ROUTES_DIR): boolean {
  if (cache.has(key)) return true;
  const file = fileFor(key, dir);
  return file !== null && existsSync(/*turbopackIgnore: true*/ file);
}

export function hasRoute(from: string, to: string, dir = ROUTES_DIR): boolean {
  return hasRouteKey(routeKey(from, to), dir);
}

export function listRouteKeys(dir = ROUTES_DIR): string[] {
  if (!existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}
