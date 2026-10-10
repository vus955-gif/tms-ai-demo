import type { DriverActivityType, VehicleMode } from "@/db/schema";
import {
  applyPause,
  BREAK_MIN,
  DAILY_LIMIT_MIN,
  DAILY_REST_MIN,
  drivingAllowance,
  type DriverClock,
} from "@/domain/driving-time";
import { positionAt } from "./geo";
import type { StoredRoute } from "./route-geometry";

const MIN = 60_000;

export type Stop = {
  orderId: string;
  purpose: "pickup" | "delivery";
  pointId: string;
  windowFromMs: number;
  windowToMs: number;
  handlingMin: number;
};

export type SimState = {
  atMs: number;
  mode: VehicleMode;
  /** End of a timed mode (break, daily_rest, handling, waiting, stopped). */
  modeUntilMs: number | null;
  /** Mode to return to after a break, rest or stop. */
  resumeMode: VehicleMode | null;
  routeKey: string | null;
  progressS: number;
  /** Point where the vehicle stands (idle, waiting, handling). */
  pointId: string | null;
  /** Upcoming stops; [0] is the current target or the stop being handled. */
  stops: Stop[];
  clock: DriverClock;
  pendingExtraMin: number;
  /** When the current mode began (waiting/idle length decides break vs. daily rest). */
  modeStartMs?: number | null;
};

export type SimEnv = {
  subjectTo561: boolean;
  /** Real seconds per base (car-profile) second, e.g. 1.2 for a tractor unit. */
  speedFactor: number;
  getRoute(key: string): StoredRoute;
  routeKeyBetween(fromPointId: string, toPointId: string): string;
  pointLngLat(pointId: string): [number, number];
  /** Time-of-day traffic multiplier on travel time (1 = free flow). */
  trafficFactor(atMs: number): number;
  /** Speed multiplier from incidents at a position (1 = normal, 0.1 = ten times slower). */
  areaSpeed(lng: number, lat: number, atMs: number): number;
  /** Forced stops of this vehicle (breakdown, road check) in absolute time. */
  forcedStops?: { startMs: number; endMs: number }[];
};

export type SimEvent =
  | { type: "arrived"; stop: Stop; atMs: number }
  | { type: "handling_started"; stop: Stop; atMs: number }
  | { type: "departed"; stop: Stop; atMs: number }
  | { type: "break_started"; atMs: number }
  | { type: "rest_started"; atMs: number };

export type ActivitySegment = { type: DriverActivityType; startMs: number; endMs: number };
export type Report = { atMs: number; lng: number; lat: number; progressS: number };

export type AdvanceOptions = { stepS?: number; reportEveryS?: number; reportPhaseS?: number };
export type AdvanceResult = { state: SimState; events: SimEvent[]; segments: ActivitySegment[]; reports: Report[] };

const ACTIVITY: Record<VehicleMode, DriverActivityType> = {
  driving: "driving",
  break: "break",
  daily_rest: "daily_rest",
  handling: "other_work",
  waiting: "other_work",
  stopped: "other_work",
  idle: "break",
};

export function cloneState(state: SimState): SimState {
  return { ...state, stops: [...state.stops], clock: { ...state.clock } };
}

/** Where the vehicle is in state `s`. */
export function locate(s: SimState, env: SimEnv): { lng: number; lat: number } {
  if (s.routeKey && s.mode !== "idle") {
    const p = positionAt(env.getRoute(s.routeKey), s.progressS);
    return { lng: p.lng, lat: p.lat };
  }
  const [lng, lat] = env.pointLngLat(s.pointId ?? s.stops[0]?.pointId ?? "");
  return { lng, lat };
}

/**
 * Moves one vehicle forward in simulated time: drives along its route, takes
 * the breaks and rests Regulation 561/2006 requires, waits for windows,
 * loads/unloads, and moves on to the next stop.
 */
export function advance(initial: SimState, toMs: number, env: SimEnv, opts: AdvanceOptions = {}): AdvanceResult {
  const stepS = opts.stepS ?? 30;
  const every = (opts.reportEveryS ?? 150) * 1000;
  const phase = (opts.reportPhaseS ?? 0) * 1000;
  const s = cloneState(initial);
  const events: SimEvent[] = [];
  const segments: ActivitySegment[] = [];
  const reports: Report[] = [];
  let nextReport = Math.floor((s.atMs - phase) / every) * every + phase + every;

  const record = (type: DriverActivityType, startMs: number, endMs: number) => {
    if (endMs <= startMs) return;
    const last = segments[segments.length - 1];
    if (last && last.type === type && last.endMs === startMs) last.endMs = endMs;
    else segments.push({ type, startMs, endMs });
  };

  const enter = (mode: VehicleMode, untilMs: number | null) => {
    s.mode = mode;
    s.modeUntilMs = untilMs;
    s.modeStartMs = s.atMs;
  };
  /** Waiting for a window: an overnight wait is a daily rest, a longer wait a break. */
  const waitType = (): DriverActivityType => {
    const minutes = ((s.modeUntilMs ?? s.atMs) - (s.modeStartMs ?? s.atMs)) / MIN;
    return minutes >= DAILY_REST_MIN ? "daily_rest" : minutes >= BREAK_MIN ? "break" : "other_work";
  };

  const startHandling = (stop: Stop) => {
    enter("handling", s.atMs + (stop.handlingMin + s.pendingExtraMin) * MIN);
    s.pendingExtraMin = 0;
    events.push({ type: "handling_started", stop, atMs: s.atMs });
  };

  const arrive = () => {
    const stop = s.stops[0];
    if (!stop) {
      enter("idle", null);
      return;
    }
    s.pointId = stop.pointId;
    events.push({ type: "arrived", stop, atMs: s.atMs });
    if (s.atMs < stop.windowFromMs) enter("waiting", stop.windowFromMs);
    else startHandling(stop);
  };

  const finishTimedMode = () => {
    switch (s.mode) {
      case "break":
        s.clock = applyPause(s.clock, "break", BREAK_MIN);
        break;
      case "daily_rest":
        if (s.clock.dailyMin > DAILY_LIMIT_MIN) s.clock = { ...s.clock, extensionsUsed: s.clock.extensionsUsed + 1 };
        s.clock = applyPause(s.clock, "daily_rest", DAILY_REST_MIN);
        break;
      case "waiting": {
        const type = waitType();
        const minutes = (s.atMs - (s.modeStartMs ?? s.atMs)) / MIN;
        if (type === "daily_rest" && s.clock.dailyMin > DAILY_LIMIT_MIN) s.clock = { ...s.clock, extensionsUsed: s.clock.extensionsUsed + 1 };
        if (type !== "other_work") s.clock = applyPause(s.clock, type, minutes);
        startHandling(s.stops[0]);
        return;
      }
      case "handling": {
        const done = s.stops.shift();
        if (done) events.push({ type: "departed", stop: done, atMs: s.atMs });
        const next = s.stops[0];
        if (next && done) {
          s.routeKey = env.routeKeyBetween(done.pointId, next.pointId);
          s.progressS = 0;
          s.pointId = null;
          enter("driving", null);
        } else {
          s.routeKey = null;
          s.progressS = 0;
          enter("idle", null);
        }
        return;
      }
      case "stopped":
        break;
    }
    enter(s.resumeMode ?? "driving", null);
    s.resumeMode = null;
  };

  let guard = 0;
  while (s.atMs < toMs) {
    if (++guard > 200_000) throw new Error("vehicle simulation did not converge");
    const from = s.atMs;
    const forced = env.forcedStops?.find((f) => s.atMs >= f.startMs && s.atMs < f.endMs);
    if (forced && s.mode === "driving") {
      s.resumeMode = "driving";
      enter("stopped", forced.endMs);
      continue;
    }
    if (s.mode === "driving" && s.routeKey) {
      const route = env.getRoute(s.routeKey);
      const pos = positionAt(route, s.progressS);
      const slow = (env.speedFactor * env.trafficFactor(s.atMs)) / Math.max(env.areaSpeed(pos.lng, pos.lat, s.atMs), 0.01);
      let dtS = Math.min(stepS, (toMs - s.atMs) / 1000);
      const nextForced = env.forcedStops?.filter((f) => f.startMs > s.atMs).sort((a, b) => a.startMs - b.startMs)[0];
      if (nextForced) dtS = Math.min(dtS, (nextForced.startMs - s.atMs) / 1000);
      if (env.subjectTo561) {
        const allowance = drivingAllowance(s.clock, true);
        if (allowance.remainingMin <= 1e-6) {
          const rest = allowance.untilDailyLimitMin <= allowance.untilBreakMin;
          s.resumeMode = "driving";
          enter(rest ? "daily_rest" : "break", s.atMs + (rest ? DAILY_REST_MIN : BREAK_MIN) * MIN);
          events.push({ type: rest ? "rest_started" : "break_started", atMs: s.atMs });
          continue;
        }
        dtS = Math.min(dtS, allowance.remainingMin * 60);
      }
      const remainingBase = route.durationS - s.progressS;
      const baseDelta = dtS / slow;
      if (baseDelta >= remainingBase) {
        const realS = remainingBase * slow;
        s.progressS = route.durationS;
        s.atMs += realS * 1000;
        s.clock = { ...s.clock, continuousMin: s.clock.continuousMin + realS / 60, dailyMin: s.clock.dailyMin + realS / 60 };
        record("driving", from, s.atMs);
        arrive();
      } else {
        s.progressS += baseDelta;
        s.atMs += dtS * 1000;
        s.clock = { ...s.clock, continuousMin: s.clock.continuousMin + dtS / 60, dailyMin: s.clock.dailyMin + dtS / 60 };
        record("driving", from, s.atMs);
      }
    } else if (s.mode === "driving") {
      // Driving without a route means nowhere to go.
      enter("idle", null);
      continue;
    } else if (s.mode === "idle") {
      s.atMs = toMs;
      record(ACTIVITY.idle, from, s.atMs);
      // Standing free counts as a break, and after 11 hours as the daily rest.
      const idleMin = (s.atMs - (s.modeStartMs ?? from)) / MIN;
      if (idleMin >= DAILY_REST_MIN) s.clock = applyPause(s.clock, "daily_rest", idleMin);
      else if (idleMin >= BREAK_MIN) s.clock = applyPause(s.clock, "break", idleMin);
    } else {
      const until = Math.min(s.modeUntilMs ?? toMs, toMs);
      s.atMs = until;
      record(s.mode === "waiting" ? waitType() : ACTIVITY[s.mode], from, until);
      if (s.modeUntilMs !== null && until >= s.modeUntilMs) finishTimedMode();
    }

    while (nextReport <= s.atMs) {
      const where = locate(s, env);
      reports.push({ atMs: nextReport, lng: where.lng, lat: where.lat, progressS: s.progressS });
      nextReport += every;
    }
  }
  return { state: s, events, segments, reports };
}

export type Prediction = {
  arrivalMs: number;
  drivingMin: number;
  breakMin: number;
  restMin: number;
  waitMin: number;
  handlingMin: number;
  breaks: number;
  restRequired: boolean;
  /** Driving minutes until the first required break before arrival (null = none needed). */
  firstBreakAfterDrivingMin: number | null;
};

/** Predicts arrival at the first stop matching `isTarget` (null if not reached within the horizon). */
export function predictArrival(
  state: SimState,
  env: SimEnv,
  isTarget: (stop: Stop) => boolean,
  horizonMs = 48 * 3_600_000,
): Prediction | null {
  if (state.stops[0] && isTarget(state.stops[0]) && state.pointId === state.stops[0].pointId) {
    return { arrivalMs: state.atMs, drivingMin: 0, breakMin: 0, restMin: 0, waitMin: 0, handlingMin: 0, breaks: 0, restRequired: false, firstBreakAfterDrivingMin: null };
  }
  let s = cloneState(state);
  const segments: ActivitySegment[] = [];
  const end = state.atMs + horizonMs;
  let breaks = 0;
  let rest = false;
  while (s.atMs < end) {
    const chunkEnd = Math.min(s.atMs + 2 * 3_600_000, end);
    const result = advance(s, chunkEnd, env, { stepS: 60, reportEveryS: 10 ** 9 });
    const arrival = result.events.find((e) => e.type === "arrived" && isTarget(e.stop));
    for (const e of result.events) {
      if (arrival && e.atMs > arrival.atMs) break;
      if (e.type === "break_started") breaks++;
      if (e.type === "rest_started") rest = true;
    }
    for (const seg of result.segments) {
      if (arrival && seg.startMs >= arrival.atMs) break;
      segments.push({ ...seg, endMs: arrival ? Math.min(seg.endMs, arrival.atMs) : seg.endMs });
    }
    if (arrival) {
      const sum = (type: DriverActivityType) =>
        segments.filter((x) => x.type === type).reduce((acc, x) => acc + (x.endMs - x.startMs) / MIN, 0);
      let drivenBeforeBreak: number | null = null;
      let driven = 0;
      for (const seg of segments) {
        if (seg.type === "driving") driven += (seg.endMs - seg.startMs) / MIN;
        if ((seg.type === "break" || seg.type === "daily_rest") && drivenBeforeBreak === null) drivenBeforeBreak = driven;
      }
      // Handling and waiting both count as other work; split them by the stop windows is overkill for display.
      const other = sum("other_work");
      return {
        arrivalMs: arrival.atMs,
        drivingMin: sum("driving"),
        breakMin: sum("break"),
        restMin: sum("daily_rest"),
        waitMin: 0,
        handlingMin: other,
        breaks,
        restRequired: rest,
        firstBreakAfterDrivingMin: drivenBeforeBreak,
      };
    }
    s = result.state;
    if (s.mode === "idle") return null;
  }
  return null;
}

/** An idle vehicle with confirmed work sets off towards its first stop. */
export function beginNextLeg(state: SimState, routeKeyBetween: (a: string, b: string) => string): SimState {
  if (state.mode !== "idle" || state.stops.length === 0 || !state.pointId) return state;
  const target = state.stops[0];
  if (target.pointId === state.pointId) {
    return { ...state, mode: "waiting", modeUntilMs: Math.max(state.atMs, target.windowFromMs), modeStartMs: state.atMs, routeKey: null };
  }
  return { ...state, mode: "driving", modeStartMs: state.atMs, routeKey: routeKeyBetween(state.pointId, target.pointId), progressS: 0, pointId: null };
}
