import { describe, expect, it } from "vitest";
import { buildStoredRoute, reverseStoredRoute, routeKey } from "./route-geometry";

// Straight line east along the equator: 0.01° lng ≈ 1113 m per segment.
const coords: [number, number][] = Array.from({ length: 11 }, (_, i) => [i * 0.01, 0]);
const segDist = Array(10).fill(1113);
const segDur = Array(10).fill(50);

describe("buildStoredRoute", () => {
  const route = buildStoredRoute({ from: "a", to: "b", coords, segDist, segDur, stepM: 2000 });

  it("keeps the first and last point", () => {
    expect(route.points[0].slice(0, 2)).toEqual([0, 0]);
    expect(route.points.at(-1)!.slice(0, 2)).toEqual([0.1, 0]);
  });

  it("stores totals and monotonic cumulative values", () => {
    expect(route.distanceM).toBe(11130);
    expect(route.durationS).toBe(500);
    for (let i = 1; i < route.points.length; i++) {
      expect(route.points[i][2]).toBeGreaterThan(route.points[i - 1][2]);
      expect(route.points[i][3]).toBeGreaterThanOrEqual(route.points[i - 1][3]);
    }
    expect(route.points.at(-1)![2]).toBe(11130);
    expect(route.points.at(-1)![3]).toBe(500);
  });

  it("drops intermediate points closer than the step", () => {
    // 11 points at ~1113 m spacing with a 2000 m step keeps roughly every second point.
    expect(route.points.length).toBeLessThan(11);
    expect(route.points.length).toBeGreaterThanOrEqual(6);
  });

  it("names the route by its endpoints", () => {
    expect(route.key).toBe(routeKey("a", "b"));
    expect(routeKey("a", "b")).toBe("a__b");
  });
});

describe("reverseStoredRoute", () => {
  it("swaps endpoints and recomputes cumulative values from the start", () => {
    const route = buildStoredRoute({ from: "a", to: "b", coords, segDist, segDur, stepM: 2000 });
    const back = reverseStoredRoute(route);
    expect(back.key).toBe("b__a");
    expect(back.points[0].slice(0, 2)).toEqual([0.1, 0]);
    expect(back.points[0][2]).toBe(0);
    expect(back.points.at(-1)![2]).toBe(route.distanceM);
    expect(back.points.at(-1)![3]).toBe(route.durationS);
  });
});
