import { describe, expect, it } from "vitest";
import { approximateRoute, isApproxRoute } from "./approx-route";
import { haversineM, positionAt } from "./geo";

// Poznań → Lyon, roughly 1 000 km in a straight line.
const poznan: [number, number] = [16.93, 52.41];
const lyon: [number, number] = [4.84, 45.76];

describe("approximate routes for points without a road route", () => {
  it("estimates road distance and time from the calibrated circuity and speed", () => {
    const r = approximateRoute("pt-a", "pt-b", poznan, lyon);
    const straight = haversineM(...poznan, ...lyon);
    expect(r.key).toBe("pt-a__pt-b");
    expect(r.distanceM / straight).toBeCloseTo(1.26, 2);
    expect(r.durationS / 3600).toBeCloseTo(r.distanceM / 1000 / 94, 2);
    expect(isApproxRoute(r)).toBe(true);
  });

  it("has evenly spread points that a vehicle can drive along, ending exactly at the target", () => {
    const r = approximateRoute("pt-a", "pt-b", poznan, lyon);
    expect(r.points.length).toBeGreaterThan(400);
    expect(r.points[0]).toEqual([16.93, 52.41, 0, 0]);
    expect(r.points.at(-1)).toEqual([4.84, 45.76, r.distanceM, r.durationS]);
    const mid = positionAt(r, r.durationS / 2);
    expect(mid.lng).toBeCloseTo((16.93 + 4.84) / 2, 1);
    expect(mid.distanceM).toBeCloseTo(r.distanceM / 2, -3);
  });

  it("uses a higher circuity for short trips and never returns a zero-length route", () => {
    const short = approximateRoute("pt-a", "pt-b", [16.93, 52.41], [16.98, 52.42]);
    const straight = haversineM(16.93, 52.41, 16.98, 52.42);
    expect(short.distanceM / straight).toBeCloseTo(1.32, 1);
    const same = approximateRoute("pt-a", "pt-b", poznan, poznan);
    expect(same.distanceM).toBeGreaterThan(0);
    expect(same.points).toHaveLength(2);
  });
});
