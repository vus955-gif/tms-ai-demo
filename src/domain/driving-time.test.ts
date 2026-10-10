import { describe, expect, it } from "vitest";
import { applyPause, clockFromActivities, dailyLimitMin, drivingAllowance, type ActivitySpan } from "./driving-time";

const H = 3_600_000;
const M = 60_000;

function spans(blocks: [ActivitySpan["type"], number][], start = 0): ActivitySpan[] {
  let t = start;
  return blocks.map(([type, minutes]) => {
    const span = { type, startMs: t, endMs: t + minutes * M };
    t += minutes * M;
    return span;
  });
}

describe("clockFromActivities", () => {
  it("adds up continuous and daily driving", () => {
    const clock = clockFromActivities(spans([["driving", 120], ["other_work", 30], ["driving", 60]]), 10 * H, 0);
    expect(clock.continuousMin).toBe(180);
    expect(clock.dailyMin).toBe(180);
  });

  it("resets continuous driving after a 45-minute break but keeps daily driving", () => {
    const clock = clockFromActivities(spans([["driving", 200], ["break", 45], ["driving", 30]]), 10 * H, 0);
    expect(clock.continuousMin).toBe(30);
    expect(clock.dailyMin).toBe(230);
  });

  it("does not count other work as a break", () => {
    const clock = clockFromActivities(spans([["driving", 150], ["other_work", 60], ["driving", 105]]), 10 * H, 0);
    expect(clock.continuousMin).toBe(255);
  });

  it("accepts a split break of 15 + 30 minutes in that order", () => {
    const split = clockFromActivities(spans([["driving", 100], ["break", 15], ["driving", 100], ["break", 30], ["driving", 10]]), 10 * H, 0);
    expect(split.continuousMin).toBe(10);
    const wrongOrder = clockFromActivities(spans([["driving", 100], ["break", 30], ["driving", 100], ["break", 15], ["driving", 10]]), 10 * H, 0);
    // A 30-minute pause first only counts as the first part; the later 15 does not complete it.
    expect(wrongOrder.continuousMin).toBe(210);
  });

  it("ignores pauses shorter than 15 minutes", () => {
    const clock = clockFromActivities(spans([["driving", 100], ["break", 10], ["driving", 20]]), 10 * H, 0);
    expect(clock.continuousMin).toBe(120);
  });

  it("starts the day over after a daily rest", () => {
    const clock = clockFromActivities(spans([["driving", 500], ["daily_rest", 660], ["driving", 40]]), 30 * H, 1);
    expect(clock).toMatchObject({ continuousMin: 40, dailyMin: 40, extensionsUsed: 1 });
  });

  it("counts an ongoing activity up to now", () => {
    const clock = clockFromActivities([{ type: "driving", startMs: 0, endMs: null }], 90 * M, 0);
    expect(clock.continuousMin).toBe(90);
  });
});

describe("drivingAllowance", () => {
  it("is limited by the next break", () => {
    const allowance = drivingAllowance({ continuousMin: 255, dailyMin: 300, splitFirstPart: false, extensionsUsed: 0 }, true);
    expect(allowance).toEqual({ untilBreakMin: 15, untilDailyLimitMin: 300, remainingMin: 15 });
  });

  it("is limited by the daily limit once extensions are used up", () => {
    const clock = { continuousMin: 200, dailyMin: 455, splitFirstPart: false, extensionsUsed: 2 };
    expect(dailyLimitMin(clock)).toBe(540);
    expect(drivingAllowance(clock, true).remainingMin).toBe(70);
  });

  it("allows 10 hours while an extension remains", () => {
    expect(dailyLimitMin({ continuousMin: 0, dailyMin: 0, splitFirstPart: false, extensionsUsed: 1 })).toBe(600);
  });

  it("does not apply to vans in domestic transport", () => {
    expect(drivingAllowance({ continuousMin: 400, dailyMin: 700, splitFirstPart: false, extensionsUsed: 2 }, false).remainingMin).toBe(Infinity);
  });
});

describe("applyPause", () => {
  it("leaves the clock alone for other work", () => {
    const clock = { continuousMin: 100, dailyMin: 100, splitFirstPart: false, extensionsUsed: 0 };
    expect(applyPause(clock, "other_work", 120)).toEqual(clock);
  });
});
