import { describe, expect, it } from "vitest";
import type { StoredRoute } from "./route-geometry";
import { advance, predictArrival, type SimEnv, type SimState, type Stop } from "./vehicle-sim";

const MIN = 60_000;
const H = 60 * MIN;

/** Straight east-west line of `minutes` base duration. */
function line(key: string, from: string, to: string, minutes: number, lng0 = 0): StoredRoute {
  const n = 10;
  return {
    key,
    from,
    to,
    distanceM: minutes * 1000,
    durationS: minutes * 60,
    points: Array.from({ length: n + 1 }, (_, i) => [lng0 + i * 0.01, 0, (minutes * 1000 * i) / n, (minutes * 60 * i) / n]),
  };
}

const routes: Record<string, StoredRoute> = {
  "A__B": line("A__B", "A", "B", 120),
  "B__C": line("B__C", "B", "C", 600, 0.1),
};

function env(overrides: Partial<SimEnv> = {}): SimEnv {
  return {
    subjectTo561: true,
    speedFactor: 1,
    getRoute: (key) => routes[key],
    routeKeyBetween: (a, b) => `${a}__${b}`,
    pointLngLat: (id) => (id === "A" ? [0, 0] : id === "B" ? [0.1, 0] : [0.2, 0]),
    trafficFactor: () => 1,
    areaSpeed: () => 1,
    ...overrides,
  };
}

const stop = (pointId: string, purpose: Stop["purpose"], windowFromMs = 0, windowToMs = 100 * H, handlingMin = 30): Stop => ({
  orderId: "o1",
  purpose,
  pointId,
  windowFromMs,
  windowToMs,
  handlingMin,
});

function driving(overrides: Partial<SimState> = {}): SimState {
  return {
    atMs: 0,
    mode: "driving",
    modeUntilMs: null,
    resumeMode: null,
    routeKey: "A__B",
    progressS: 0,
    pointId: null,
    stops: [stop("B", "pickup"), stop("C", "delivery")],
    clock: { continuousMin: 0, dailyMin: 0, splitFirstPart: false, extensionsUsed: 0 },
    pendingExtraMin: 0,
    ...overrides,
  };
}

describe("advance", () => {
  it("drives to the pickup, loads and heads for the delivery", () => {
    const { state, events } = advance(driving(), 3 * H, env());
    expect(events.map((e) => e.type)).toEqual(["arrived", "handling_started", "departed"]);
    expect(events[0].atMs).toBe(2 * H);
    expect(events[2].atMs).toBe(2 * H + 30 * MIN);
    expect(state).toMatchObject({ mode: "driving", routeKey: "B__C", stops: [{ pointId: "C" }] });
    expect(state.progressS).toBeCloseTo(30 * 60, 6);
  });

  it("takes a 45-minute break after 4 h 30 min of driving", () => {
    const start = driving({ routeKey: "B__C", stops: [stop("C", "delivery")], clock: { continuousMin: 250, dailyMin: 250, splitFirstPart: false, extensionsUsed: 0 } });
    const { state, events, segments } = advance(start, 2 * H, env());
    expect(events[0]).toEqual({ type: "break_started", atMs: 20 * MIN });
    expect(segments.map((s) => s.type)).toEqual(["driving", "break", "driving"]);
    expect(segments[1]).toMatchObject({ startMs: 20 * MIN, endMs: 65 * MIN });
    expect(state.clock.continuousMin).toBeCloseTo(55, 6);
    expect(state.clock.dailyMin).toBeCloseTo(250 + 75, 6);
  });

  it("takes an 11-hour rest when the daily limit is reached", () => {
    const start = driving({ routeKey: "B__C", stops: [stop("C", "delivery")], clock: { continuousMin: 100, dailyMin: 530, splitFirstPart: false, extensionsUsed: 2 } });
    const { state, events } = advance(start, 12 * H, env());
    expect(events[0]).toEqual({ type: "rest_started", atMs: 10 * MIN });
    expect(state.clock.dailyMin).toBeCloseTo(12 * 60 - 10 - 660, 6);
  });

  it("waits for the window to open before loading", () => {
    const start = driving({ stops: [stop("B", "pickup", 3 * H), stop("C", "delivery")] });
    const { events, segments } = advance(start, 4 * H, env());
    expect(events.find((e) => e.type === "handling_started")!.atMs).toBe(3 * H);
    expect(segments[1]).toMatchObject({ type: "other_work", startMs: 2 * H });
  });

  it("adds pending extra minutes to loading (ramp wait)", () => {
    const { events } = advance(driving({ pendingExtraMin: 90 }), 5 * H, env());
    const started = events.find((e) => e.type === "handling_started")!;
    const departed = events.find((e) => e.type === "departed")!;
    expect(departed.atMs - started.atMs).toBe(120 * MIN);
  });

  it("slows down inside an incident area and with slower vehicles", () => {
    const slowArea = advance(driving(), 2 * H, env({ areaSpeed: () => 0.5 }));
    expect(slowArea.state.progressS).toBeCloseTo(60 * 60, 6);
    const truck = advance(driving(), 2 * H, env({ speedFactor: 1.2 }));
    expect(truck.state.progressS).toBeCloseTo(100 * 60, 6);
  });

  it("does not insert breaks for vans outside Regulation 561/2006", () => {
    const start = driving({ routeKey: "B__C", stops: [stop("C", "delivery")], clock: { continuousMin: 260, dailyMin: 260, splitFirstPart: false, extensionsUsed: 0 } });
    const { events } = advance(start, 3 * H, env({ subjectTo561: false }));
    expect(events.filter((e) => e.type === "break_started")).toHaveLength(0);
  });

  it("reports the position on the GPS cadence", () => {
    const { reports } = advance(driving(), 10 * MIN, env(), { reportEveryS: 150, reportPhaseS: 0 });
    expect(reports.map((r) => r.atMs)).toEqual([150_000, 300_000, 450_000, 600_000]);
    expect(reports[3].lng).toBeGreaterThan(reports[0].lng);
  });

  it("idles after the last stop", () => {
    const start = driving({ routeKey: "A__B", stops: [stop("B", "delivery")] });
    const { state } = advance(start, 4 * H, env());
    expect(state).toMatchObject({ mode: "idle", pointId: "B", routeKey: null, stops: [] });
  });
});

describe("predictArrival", () => {
  it("predicts arrival with breaks and handling on the way", () => {
    const start = driving({ clock: { continuousMin: 200, dailyMin: 200, splitFirstPart: false, extensionsUsed: 0 } });
    const prediction = predictArrival(start, env(), (s) => s.purpose === "delivery")!;
    // 70 min driving → break 45 → 50 min to B, 30 min loading, 600 min to C with breaks after 270 min each.
    expect(prediction.breaks).toBeGreaterThanOrEqual(2);
    expect(prediction.firstBreakAfterDrivingMin).toBeCloseTo(70, 6);
    expect(prediction.drivingMin).toBeCloseTo(720, 0);
    expect(prediction.restRequired).toBe(true);
  });

  it("returns arrival without breaks for a short trip", () => {
    const prediction = predictArrival(driving({ stops: [stop("B", "delivery")] }), env(), (s) => s.purpose === "delivery")!;
    expect(prediction.arrivalMs).toBe(2 * H);
    expect(prediction.breaks).toBe(0);
    expect(prediction.firstBreakAfterDrivingMin).toBeNull();
  });
});

describe("forced stops", () => {
  it("stops the vehicle for a breakdown and resumes afterwards", () => {
    const { segments, state } = advance(driving(), 2 * H, env({ forcedStops: [{ startMs: 30 * MIN, endMs: 90 * MIN }] }));
    expect(segments.map((s) => s.type)).toEqual(["driving", "other_work", "driving"]);
    expect(segments[1]).toMatchObject({ startMs: 30 * MIN, endMs: 90 * MIN });
    expect(state.progressS).toBeCloseTo(60 * 60, 6);
  });
});
