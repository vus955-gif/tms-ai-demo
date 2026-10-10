/**
 * One-off route generator. Queries the public OSRM demo server for every pair of
 * scenario points (one direction, the reverse is derived) and writes compact JSON
 * files to data/routes. Respects the demo server usage policy: one request per
 * second, identifying User-Agent, existing files are skipped.
 *
 * Usage: npm run routes:precompute
 * Route data © OpenStreetMap contributors (ODbL), routing by OSRM.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStoredRoute, reverseStoredRoute, routeKey, type StoredRoute } from "../src/simulation/route-geometry";
import { points } from "../src/simulation/scenario/points";

const OSRM = process.env.OSRM_URL ?? "https://router.project-osrm.org";
const OUT = path.join(process.cwd(), "data", "routes");
const USER_AGENT = "tms-ai-demo/0.1 (open-source demo; one-off route precompute)";
const STEP_M = 2000;
const DELAY_MS = 1100;

type OsrmResponse = {
  code: string;
  routes: {
    geometry: { coordinates: [number, number][] };
    legs: { annotation: { distance: number[]; duration: number[] } }[];
  }[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function fetchRoute(
  from: { id: string; lat: number; lng: number },
  to: { id: string; lat: number; lng: number },
  via: { lat: number; lng: number }[] = [],
): Promise<StoredRoute> {
  const coordinates = [from, ...via, to].map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&annotations=distance,duration`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as OsrmResponse;
      if (body.code !== "Ok" || !body.routes[0]) throw new Error(`OSRM code ${body.code}`);
      const route = body.routes[0];
      const segDist = route.legs.flatMap((l) => l.annotation.distance);
      const segDur = route.legs.flatMap((l) => l.annotation.duration);
      return buildStoredRoute({ from: from.id, to: to.id, coords: route.geometry.coordinates, segDist, segDur, stepM: STEP_M });
    } catch (error) {
      console.warn(`  attempt ${attempt} failed for ${from.id} → ${to.id}: ${(error as Error).message}`);
      await sleep(DELAY_MS * attempt * 3);
    }
  }
  throw new Error(`Giving up on ${from.id} → ${to.id}`);
}

export async function writeRoute(route: StoredRoute, outDir = OUT) {
  await writeFile(path.join(outDir, `${route.key}.json`), JSON.stringify(route));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let fetched = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const forward = path.join(OUT, `${routeKey(a.id, b.id)}.json`);
      const backward = path.join(OUT, `${routeKey(b.id, a.id)}.json`);
      if ((await exists(forward)) && (await exists(backward))) continue;
      const route = await fetchRoute(a, b);
      await writeRoute(route);
      await writeRoute(reverseStoredRoute(route));
      fetched++;
      console.log(`${fetched}: ${a.id} ↔ ${b.id} ${(route.distanceM / 1000).toFixed(0)} km`);
      await sleep(DELAY_MS);
    }
  }
  const sample = JSON.parse(await readFile(path.join(OUT, `${routeKey(points[0].id, points[1].id)}.json`), "utf8"));
  console.log(`Done. Fetched ${fetched} pairs. Sample: ${sample.key} ${sample.points.length} points.`);
}

if (process.argv[1]?.endsWith("precompute-routes.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
