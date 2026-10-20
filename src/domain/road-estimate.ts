/**
 * Road distance and time without a routing engine, for points that have no
 * precomputed OSRM route (clients and points added in the app).
 *
 * Calibrated on the 535 precomputed routes in data/routes longer than 20 km
 * (OSRM car profile, OpenStreetMap data, free-flow times):
 * - road distance / straight-line distance: median 1.258 (10th–90th percentile 1.13–1.46),
 *   median 1.32 for the 18 shorter routes;
 * - average speed: median 94 km/h (10th–90th percentile 78–102 km/h).
 * Vehicle simulation still applies its own slow-down per vehicle kind on top.
 */
export const ROAD_CIRCUITY = 1.26;
export const ROAD_CIRCUITY_SHORT = 1.32;
export const SHORT_TRIP_M = 20_000;
export const APPROX_SPEED_KMH = 94;

/** Estimated road distance in metres from a straight-line distance. */
export function roadDistanceM(straightM: number): number {
  return straightM * (straightM < SHORT_TRIP_M ? ROAD_CIRCUITY_SHORT : ROAD_CIRCUITY);
}

/** Estimated free-flow driving time in seconds for a road distance. */
export function roadDurationS(roadM: number): number {
  return roadM / ((APPROX_SPEED_KMH * 1000) / 3600);
}
