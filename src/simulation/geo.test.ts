import { describe, expect, it } from "vitest";
import { distanceFraction, haversineM, nearestProgressS, positionAt, sliceCoordinates } from "./geo";
import type { StoredRoute } from "./route-geometry";

const route: StoredRoute = {
  key: "a__b",
  from: "a",
  to: "b",
  distanceM: 2000,
  durationS: 200,
  points: [
    [0, 0, 0, 0],
    [0.01, 0, 1000, 50],
    [0.02, 0, 2000, 200],
  ],
};

describe("geo", () => {
  it("measures distance on the sphere", () => {
    expect(haversineM(16.93, 52.41, 21.01, 52.23)).toBeGreaterThan(275_000);
    expect(haversineM(16.93, 52.41, 21.01, 52.23)).toBeLessThan(285_000);
  });

  it("interpolates the position along base duration", () => {
    expect(positionAt(route, 25).lng).toBeCloseTo(0.005, 6);
    // Second segment is slower: 150 s for 1000 m.
    expect(positionAt(route, 125).lng).toBeCloseTo(0.015, 6);
    expect(positionAt(route, 125).distanceM).toBeCloseTo(1500, 6);
  });

  it("clamps outside the route", () => {
    expect(positionAt(route, -10).lng).toBe(0);
    expect(positionAt(route, 999).lng).toBe(0.02);
  });

  it("finds the nearest point and the covered fraction", () => {
    expect(nearestProgressS(route, 0.0101, 0.0001)).toBe(50);
    expect(distanceFraction(route, 50)).toBeCloseTo(0.5, 6);
  });

  it("slices coordinates between two progress values", () => {
    const coords = sliceCoordinates(route, 25, 125);
    expect(coords[0][0]).toBeCloseTo(0.005, 6);
    expect(coords[1]).toEqual([0.01, 0]);
    expect(coords.at(-1)![0]).toBeCloseTo(0.015, 6);
  });
});
