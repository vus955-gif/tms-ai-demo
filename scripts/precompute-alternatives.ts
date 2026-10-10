/**
 * One-off: alternative routes for scripted incidents. The A2 detour starts where
 * PO 4K21 is a few minutes after the accident and goes via Kostrzyn nad Odrą.
 *
 * Usage: npx tsx scripts/precompute-alternatives.ts
 * Route data © OpenStreetMap contributors (ODbL), routing by OSRM.
 */
import { getRoute } from "../src/adapters/routing/static-routes";
import { positionAt } from "../src/simulation/geo";
import { points } from "../src/simulation/scenario/points";
import { fetchRoute, writeRoute } from "./precompute-routes";

async function main() {
  const main = getRoute("pt-meble-swarzedz", "pt-meble-berlin");
  // ZL-1031 starts at 38% of the route; ~25 minutes later (truck, morning peak) it is ~15 base minutes further.
  const start = positionAt(main, main.durationS * 0.38 + 15 * 60);
  const berlin = points.find((p) => p.id === "pt-meble-berlin")!;
  const kostrzyn = { lat: 52.588, lng: 14.647 };
  const route = await fetchRoute({ id: "a2-objazd", lat: start.lat, lng: start.lng }, berlin, [kostrzyn]);
  const alt = { ...route, key: "alt__a2-kostrzyn", from: "a2-objazd" };
  await writeRoute(alt);
  console.log(`alt__a2-kostrzyn: ${(alt.distanceM / 1000).toFixed(0)} km, ${(alt.durationS / 60).toFixed(0)} min, start ${start.lat.toFixed(4)},${start.lng.toFixed(4)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
