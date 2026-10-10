import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { routeKey, type StoredRoute } from "@/simulation/route-geometry";

/** Precomputed routes (© OpenStreetMap contributors, ODbL; routing by OSRM). */
export const ROUTES_DIR = path.join(process.cwd(), "data", "routes");

/** Route keys are ids joined by "__" — nothing that could leave the routes directory. */
export const ROUTE_KEY_RE = /^[a-z0-9-]+__[a-z0-9-]+$/i;

const cache = new Map<string, StoredRoute>();

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

export function getRouteByKey(key: string, dir = ROUTES_DIR): StoredRoute {
  const cached = cache.get(key);
  if (cached) return cached;
  const file = fileFor(key, dir);
  if (!file || !existsSync(/*turbopackIgnore: true*/ file)) throw new MissingRouteError(key);
  const route = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as StoredRoute;
  cache.set(key, route);
  return route;
}

export function getRoute(from: string, to: string, dir = ROUTES_DIR): StoredRoute {
  return getRouteByKey(routeKey(from, to), dir);
}

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
