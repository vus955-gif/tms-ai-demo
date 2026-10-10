import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { routeKey, type StoredRoute } from "@/simulation/route-geometry";

/** Precomputed routes (© OpenStreetMap contributors, ODbL; routing by OSRM). */
export const ROUTES_DIR = path.join(process.cwd(), "data", "routes");

const cache = new Map<string, StoredRoute>();

export class MissingRouteError extends Error {
  constructor(readonly key: string) {
    super(`No precomputed route "${key}". Run: npm run routes:precompute`);
  }
}

export function getRouteByKey(key: string, dir = ROUTES_DIR): StoredRoute {
  const cached = cache.get(key);
  if (cached) return cached;
  const file = path.join(dir, `${key}.json`);
  if (!existsSync(file)) throw new MissingRouteError(key);
  const route = JSON.parse(readFileSync(file, "utf8")) as StoredRoute;
  cache.set(key, route);
  return route;
}

export function getRoute(from: string, to: string, dir = ROUTES_DIR): StoredRoute {
  return getRouteByKey(routeKey(from, to), dir);
}

export function hasRoute(from: string, to: string, dir = ROUTES_DIR): boolean {
  return cache.has(routeKey(from, to)) || existsSync(path.join(dir, `${routeKey(from, to)}.json`));
}

export function listRouteKeys(dir = ROUTES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}
