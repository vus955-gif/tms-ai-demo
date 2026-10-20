/**
 * Road distance and time without a routing engine, for points that have no
 * precomputed OSRM route (clients and points added in the app).
 *
 * Calibrated on the 553 precomputed routes in data/routes (OSRM car profile,
 * OpenStreetMap data, free-flow times), by straight-line distance:
 * - road distance / straight-line distance: median 1.258 for routes over 20 km
 *   (10th–90th percentile 1.13–1.46), median 1.32 for shorter ones;
 * - average speed, median per band: under 20 km 48.7 km/h (n=18), 20–60 km 55.8 (n=14),
 *   60–150 km 84.1 (n=59), 150–400 km 93.0 (n=346), over 400 km 99.2 (n=116).
 * The data covers Poland, Germany and Czechia; elsewhere it is an extrapolation.
 * Vehicle simulation still applies its own slow-down per vehicle kind on top.
 */
export const ROAD_CIRCUITY = 1.26;
export const ROAD_CIRCUITY_SHORT = 1.32;
export const SHORT_TRIP_M = 20_000;

/** (straight-line km at the middle of a band, median km/h of that band). */
const SPEED_CURVE: [number, number][] = [
  [10, 48.7],
  [40, 55.8],
  [105, 84.1],
  [275, 93.0],
  [600, 99.2],
];

/** Average free-flow speed for a trip of this straight-line length (interpolated between bands). */
export function approxSpeedKmh(straightKm: number): number {
  if (straightKm <= SPEED_CURVE[0][0]) return SPEED_CURVE[0][1];
  for (let i = 1; i < SPEED_CURVE.length; i++) {
    const [x1, y1] = SPEED_CURVE[i];
    if (straightKm <= x1) {
      const [x0, y0] = SPEED_CURVE[i - 1];
      return y0 + ((y1 - y0) * (straightKm - x0)) / (x1 - x0);
    }
  }
  return SPEED_CURVE[SPEED_CURVE.length - 1][1];
}

/** Estimated road distance in metres from a straight-line distance. */
export function roadDistanceM(straightM: number): number {
  return straightM * (straightM < SHORT_TRIP_M ? ROAD_CIRCUITY_SHORT : ROAD_CIRCUITY);
}

/** Estimated free-flow driving time in seconds for a trip of this straight-line length. */
export function roadDurationS(straightM: number): number {
  return roadDistanceM(straightM) / ((approxSpeedKmh(straightM / 1000) * 1000) / 3600);
}
