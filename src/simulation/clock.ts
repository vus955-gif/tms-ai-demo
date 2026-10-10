import { TZDate } from "@date-fns/tz";

export const WARSAW = "Europe/Warsaw";
export const SPEEDS = [1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];

export type ClockState = {
  simOrigin: Date;
  /** Simulated time accumulated up to `realResumedAt` (or up to the pause). */
  simElapsedMs: number;
  running: boolean;
  speed: Speed;
  realResumedAt: Date;
};

export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value);
}

function elapsedAt(state: ClockState, realNow: Date): number {
  const live = state.running ? (realNow.getTime() - state.realResumedAt.getTime()) * state.speed : 0;
  return state.simElapsedMs + Math.max(0, live);
}

export function simNow(state: ClockState, realNow: Date): Date {
  return new Date(state.simOrigin.getTime() + elapsedAt(state, realNow));
}

export function pauseClock(state: ClockState, realNow: Date): ClockState {
  if (!state.running) return state;
  return { ...state, simElapsedMs: elapsedAt(state, realNow), running: false, realResumedAt: realNow };
}

export function resumeClock(state: ClockState, realNow: Date): ClockState {
  if (state.running) return state;
  return { ...state, running: true, realResumedAt: realNow };
}

export function setSpeed(state: ClockState, speed: Speed, realNow: Date): ClockState {
  return { ...state, simElapsedMs: elapsedAt(state, realNow), speed, realResumedAt: realNow };
}

/** 08:30 Warsaw time on the latest weekday (Mon–Fri) not later than `realNow`'s Warsaw date. */
export function simOriginFor(realNow: Date): Date {
  const local = new TZDate(realNow.getTime(), WARSAW);
  const day = local.getDay(); // 0 = Sunday
  const back = day === 6 ? 1 : day === 0 ? 2 : 0;
  const origin = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() - back, 8, 30, WARSAW);
  return new Date(origin.getTime());
}
