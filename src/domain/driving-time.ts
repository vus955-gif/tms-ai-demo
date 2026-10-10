import type { DriverActivityType } from "@/db/schema";

/**
 * Simplified Regulation (EC) 561/2006 model used by the demo (spec §7.1):
 * break after 4 h 30 min of driving (45 min, or 15 + 30 split), 9 h daily
 * driving (10 h while extensions remain, max 2 per week), 11 h daily rest.
 * Weekly limits and reduced rests are out of scope.
 */
export const CONTINUOUS_LIMIT_MIN = 270;
export const BREAK_MIN = 45;
export const SPLIT_FIRST_MIN = 15;
export const SPLIT_SECOND_MIN = 30;
export const DAILY_LIMIT_MIN = 540;
export const DAILY_EXTENDED_LIMIT_MIN = 600;
export const MAX_EXTENSIONS_PER_WEEK = 2;
export const DAILY_REST_MIN = 660;

export type DriverClock = {
  /** Driving since the last qualifying break. */
  continuousMin: number;
  /** Driving since the last daily rest. */
  dailyMin: number;
  /** A 15-minute first part of a split break has been taken. */
  splitFirstPart: boolean;
  extensionsUsed: number;
};

export type ActivitySpan = { type: DriverActivityType; startMs: number; endMs: number | null };

export function dailyLimitMin(clock: DriverClock): number {
  return clock.extensionsUsed < MAX_EXTENSIONS_PER_WEEK ? DAILY_EXTENDED_LIMIT_MIN : DAILY_LIMIT_MIN;
}

/** Applies a finished non-driving pause of `minutes` to the clock. */
export function applyPause(clock: DriverClock, type: DriverActivityType, minutes: number): DriverClock {
  if (type === "daily_rest") return { ...clock, continuousMin: 0, dailyMin: 0, splitFirstPart: false };
  if (type !== "break") return clock;
  if (minutes >= BREAK_MIN) return { ...clock, continuousMin: 0, splitFirstPart: false };
  if (clock.splitFirstPart && minutes >= SPLIT_SECOND_MIN) return { ...clock, continuousMin: 0, splitFirstPart: false };
  if (!clock.splitFirstPart && minutes >= SPLIT_FIRST_MIN) return { ...clock, splitFirstPart: true };
  return clock;
}

/** Rebuilds the clock from an activity history (ongoing activities end at `nowMs`). */
export function clockFromActivities(activities: ActivitySpan[], nowMs: number, extensionsUsed: number): DriverClock {
  const sorted = [...activities].sort((a, b) => a.startMs - b.startMs);
  let clock: DriverClock = { continuousMin: 0, dailyMin: 0, splitFirstPart: false, extensionsUsed };
  for (const a of sorted) {
    const end = Math.min(a.endMs ?? nowMs, nowMs);
    if (end <= a.startMs) continue;
    const minutes = (end - a.startMs) / 60_000;
    if (a.type === "driving") clock = { ...clock, continuousMin: clock.continuousMin + minutes, dailyMin: clock.dailyMin + minutes };
    else clock = applyPause(clock, a.type, minutes);
  }
  return clock;
}

export type DrivingAllowance = {
  /** Minutes of driving until a break is required (Infinity when 561 does not apply). */
  untilBreakMin: number;
  /** Minutes of driving until the daily limit. */
  untilDailyLimitMin: number;
  /** min(untilBreak, untilDailyLimit) */
  remainingMin: number;
};

export function drivingAllowance(clock: DriverClock, subjectTo561: boolean): DrivingAllowance {
  if (!subjectTo561) return { untilBreakMin: Infinity, untilDailyLimitMin: Infinity, remainingMin: Infinity };
  const untilBreakMin = Math.max(0, CONTINUOUS_LIMIT_MIN - clock.continuousMin);
  const untilDailyLimitMin = Math.max(0, dailyLimitMin(clock) - clock.dailyMin);
  return { untilBreakMin, untilDailyLimitMin, remainingMin: Math.min(untilBreakMin, untilDailyLimitMin) };
}
