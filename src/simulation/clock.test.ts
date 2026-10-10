import { describe, expect, it } from "vitest";
import { pauseClock, resumeClock, setSpeed, simNow, simOriginFor, type ClockState } from "./clock";

const MIN = 60_000;
const origin = new Date("2026-10-12T06:30:00Z"); // 08:30 Warsaw (CEST)
const start = new Date("2026-10-11T20:00:00Z");

function running(speed: ClockState["speed"] = 10): ClockState {
  return { simOrigin: origin, simElapsedMs: 0, running: true, speed, realResumedAt: start };
}

describe("simNow", () => {
  it("advances ten simulated minutes per real minute at 10x", () => {
    expect(simNow(running(), new Date(start.getTime() + MIN))).toEqual(new Date(origin.getTime() + 10 * MIN));
  });

  it("freezes while paused", () => {
    const paused = pauseClock(running(), new Date(start.getTime() + MIN));
    expect(simNow(paused, new Date(start.getTime() + 30 * MIN))).toEqual(new Date(origin.getTime() + 10 * MIN));
  });

  it("continues without a jump after resuming", () => {
    const paused = pauseClock(running(), new Date(start.getTime() + MIN));
    const resumed = resumeClock(paused, new Date(start.getTime() + 30 * MIN));
    expect(simNow(resumed, new Date(start.getTime() + 31 * MIN))).toEqual(new Date(origin.getTime() + 20 * MIN));
  });

  it("stays continuous when the speed changes", () => {
    const changeAt = new Date(start.getTime() + MIN);
    const faster = setSpeed(running(10), 60, changeAt);
    expect(simNow(faster, changeAt)).toEqual(new Date(origin.getTime() + 10 * MIN));
    expect(simNow(faster, new Date(changeAt.getTime() + MIN))).toEqual(new Date(origin.getTime() + 70 * MIN));
  });

  it("keeps a paused clock paused when the speed changes", () => {
    const paused = pauseClock(running(), new Date(start.getTime() + MIN));
    const changed = setSpeed(paused, 60, new Date(start.getTime() + 5 * MIN));
    expect(changed.running).toBe(false);
    expect(simNow(changed, new Date(start.getTime() + 9 * MIN))).toEqual(new Date(origin.getTime() + 10 * MIN));
  });

  it("ignores pausing twice and resuming a running clock", () => {
    const at = new Date(start.getTime() + MIN);
    const once = pauseClock(running(), at);
    expect(pauseClock(once, new Date(start.getTime() + 5 * MIN))).toEqual(once);
    const live = running();
    expect(resumeClock(live, at)).toEqual(live);
  });
});

describe("simOriginFor", () => {
  it("uses 08:30 Warsaw time of the same weekday", () => {
    // Wednesday 2026-10-14 14:00 Warsaw
    expect(simOriginFor(new Date("2026-10-14T12:00:00Z"))).toEqual(new Date("2026-10-14T06:30:00Z"));
  });

  it("uses the same day even before 08:30", () => {
    // Monday 2026-10-12 07:00 Warsaw
    expect(simOriginFor(new Date("2026-10-12T05:00:00Z"))).toEqual(new Date("2026-10-12T06:30:00Z"));
  });

  it("falls back to Friday on Saturday and Sunday", () => {
    expect(simOriginFor(new Date("2026-10-17T10:00:00Z"))).toEqual(new Date("2026-10-16T06:30:00Z"));
    expect(simOriginFor(new Date("2026-10-18T10:00:00Z"))).toEqual(new Date("2026-10-16T06:30:00Z"));
  });

  it("follows winter time after the DST change", () => {
    // Tuesday 2026-11-03, CET (UTC+1) → 08:30 Warsaw is 07:30 UTC
    expect(simOriginFor(new Date("2026-11-03T12:00:00Z"))).toEqual(new Date("2026-11-03T07:30:00Z"));
  });

  it("uses the Warsaw date, not the UTC date, near midnight", () => {
    // Saturday 2026-10-17 00:30 Warsaw is still Friday 22:30 UTC → Warsaw says Saturday → Friday
    expect(simOriginFor(new Date("2026-10-16T22:30:00Z"))).toEqual(new Date("2026-10-16T06:30:00Z"));
  });
});
