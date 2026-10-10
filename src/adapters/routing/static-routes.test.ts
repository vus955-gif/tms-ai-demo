import { describe, expect, it } from "vitest";
import { scenario } from "@/simulation/scenario";
import { getRoute, hasRoute, listRouteKeys, MissingRouteError } from "./static-routes";

describe("static routes", () => {
  it("covers every ordered pair of scenario points", () => {
    const keys = new Set(listRouteKeys());
    const missing: string[] = [];
    for (const a of scenario.points)
      for (const b of scenario.points) if (a.id !== b.id && !keys.has(`${a.id}__${b.id}`)) missing.push(`${a.id}__${b.id}`);
    expect(missing, "run `npm run routes:precompute`").toEqual([]);
  });

  it("loads a route with plausible geometry and totals", () => {
    const route = getRoute("pt-baza-poznan", "pt-baza-lodz");
    expect(route.from).toBe("pt-baza-poznan");
    expect(route.to).toBe("pt-baza-lodz");
    expect(route.distanceM).toBeGreaterThan(180_000);
    expect(route.distanceM).toBeLessThan(260_000);
    expect(route.durationS).toBeGreaterThan(2 * 3600);
    expect(route.points.length).toBeGreaterThan(20);
    const [lng, lat] = route.points[0];
    expect(lat).toBeCloseTo(52.34, 1);
    expect(lng).toBeCloseTo(16.81, 1);
  });

  it("keeps both directions consistent in length", () => {
    const there = getRoute("pt-meble-swarzedz", "pt-meble-berlin");
    const back = getRoute("pt-meble-berlin", "pt-meble-swarzedz");
    expect(back.distanceM).toBe(there.distanceM);
    expect(back.points[0].slice(0, 2)).toEqual(there.points.at(-1)!.slice(0, 2));
  });

  it("explains how to fix a missing route", () => {
    expect(hasRoute("pt-nowhere", "pt-baza-lodz")).toBe(false);
    expect(() => getRoute("pt-nowhere", "pt-baza-lodz")).toThrow(MissingRouteError);
  });
});
