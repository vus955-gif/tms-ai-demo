import { describe, expect, it } from "vitest";
import type { StoredRoute } from "@/simulation/route-geometry";
import type { SimEnv, SimState } from "@/simulation/vehicle-sim";
import { evaluateCandidate, matchCandidates, type MatchCandidate, type MatchOrder } from "./matching";

const H = 3_600_000;
const pos: Record<string, number> = { BASE: 0, NEAR: 0.05, P: 0.1, D: 0.6, FAR: 1.5 };

/** Straight routes where 1 base minute = 1 km and 0.01° ≈ 10 km. */
function routeBetween(a: string, b: string): StoredRoute {
  const km = Math.round(Math.abs(pos[b] - pos[a]) * 1000);
  return {
    key: `${a}__${b}`,
    from: a,
    to: b,
    distanceM: km * 1000,
    durationS: km * 60,
    points: [
      [pos[a], 0, 0, 0],
      [pos[b], 0, km * 1000, km * 60],
    ],
  };
}

const env: SimEnv = {
  subjectTo561: true,
  speedFactor: 1,
  getRoute: (key) => {
    const [a, b] = key.split("__");
    return routeBetween(a, b);
  },
  routeKeyBetween: (a, b) => `${a}__${b}`,
  pointLngLat: (id) => [pos[id], 0],
  trafficFactor: () => 1,
  areaSpeed: () => 1,
};

const order: MatchOrder = {
  id: "new",
  clientId: "cl",
  pickupPointId: "P",
  deliveryPointId: "D",
  pickupFromMs: 1 * H,
  pickupToMs: 4 * H,
  deliveryFromMs: 0,
  deliveryToMs: 24 * H,
  cargoPallets: 12,
  cargoKg: 6000,
  bodyRequired: null,
  adrRequired: false,
  pickupHandlingMin: 30,
  deliveryHandlingMin: 30,
};

function idleAt(point: string): SimState {
  return {
    atMs: 0,
    mode: "idle",
    modeUntilMs: null,
    resumeMode: null,
    routeKey: null,
    progressS: 0,
    pointId: point,
    stops: [],
    clock: { continuousMin: 0, dailyMin: 0, splitFirstPart: false, extensionsUsed: 0 },
    pendingExtraMin: 0,
  };
}

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    vehicleId: "v",
    driverId: "d",
    capacityPallets: 33,
    capacityKg: 24000,
    body: "plandeka",
    adr: false,
    driverAdr: false,
    sim: idleAt("NEAR"),
    env,
    freePointId: "NEAR",
    historyWithClient: 0,
    distanceM: (a, b) => routeBetween(a, b).distanceM,
    ...overrides,
  };
}

describe("matching", () => {
  it("excludes a van that is too small, with the reason", () => {
    const r = evaluateCandidate(order, candidate({ capacityPallets: 10 }));
    expect(r).toMatchObject({ tier: "excluded", reasons: ["za mała pojemność: 12 palet (mieści 10)"] });
  });

  it("excludes missing ADR, missing reefer and too little payload", () => {
    expect(evaluateCandidate({ ...order, adrRequired: true }, candidate({ adr: true })).reasons[0]).toBe("kierowca bez zaświadczenia ADR");
    expect(evaluateCandidate({ ...order, adrRequired: true }, candidate()).reasons[0]).toBe("pojazd bez wyposażenia ADR");
    expect(evaluateCandidate({ ...order, bodyRequired: "chlodnia" }, candidate()).reasons[0]).toBe("wymagana chłodnia");
    expect(evaluateCandidate(order, candidate({ capacityKg: 3000 })).reasons[0]).toContain("za mała ładowność");
  });

  it("excludes a vehicle that cannot reach the pickup window", () => {
    const r = evaluateCandidate(order, candidate({ sim: idleAt("FAR"), freePointId: "FAR" }));
    expect(r.tier).toBe("excluded");
    expect(r.reasons[0]).toContain("nie zdąży na załadunek");
  });

  it("ranks a nearby driver who knows the client highest, with reasons", () => {
    const near = candidate({ vehicleId: "near", historyWithClient: 6 });
    const base = candidate({ vehicleId: "base", sim: idleAt("BASE"), freePointId: "BASE" });
    const [first, second] = matchCandidates(order, [base, near]);
    expect(first.vehicleId).toBe("near");
    expect(first.reasons).toEqual(expect.arrayContaining(["50 km od załadunku", "wolny teraz", "był u klienta 6 razy"]));
    expect(first.score).toBeGreaterThan(second.score);
  });

  it("notes a reefer used for dry goods", () => {
    const r = evaluateCandidate(order, candidate({ body: "chlodnia" }));
    expect(r.reasons).toContain("chłodnia na towar suchy");
  });

  it("counts the approach from the end of the current queue", () => {
    const busy = candidate({
      sim: {
        ...idleAt("NEAR"),
        mode: "driving",
        pointId: null,
        routeKey: "NEAR__FAR",
        stops: [{ orderId: "old", purpose: "delivery", pointId: "FAR", windowFromMs: 0, windowToMs: 48 * H, handlingMin: 30 }],
      },
      freePointId: "FAR",
    });
    const r = evaluateCandidate(order, busy);
    expect(r.tier).toBe("excluded");
  });
});
