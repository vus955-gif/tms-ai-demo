import { describe, expect, it } from "vitest";
import { formatHm, formatSimClock, formatTime, formatUsd } from "./format";

describe("format helpers", () => {
  it("shows simulation time in Warsaw with a Polish weekday", () => {
    expect(formatSimClock("2026-10-14T08:42:00Z")).toBe("śr 14.10 · 10:42");
    expect(formatTime("2026-11-03T07:30:00Z")).toBe("08:30");
  });

  it("formats durations as hours:minutes", () => {
    expect(formatHm(255)).toBe("4:15");
    expect(formatHm(5)).toBe("0:05");
    expect(formatHm(-3)).toBe("0:00");
  });

  it("formats tiny AI costs in cents", () => {
    expect(formatUsd(0)).toBe("0 USD");
    expect(formatUsd(0.00045)).toBe("0,045 ¢");
    expect(formatUsd(1.5)).toBe("1,50 USD");
  });
});
