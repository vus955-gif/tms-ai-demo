import { describe, expect, it } from "vitest";
import { forecastState, plannedDays, runOn, warsawDate } from "./recurring";

// Wednesday 14.10.2026, 10:00 in Warsaw.
const now = new Date("2026-10-14T08:00:00Z");
const times = { pickupFromMin: 6 * 60, pickupToMin: 8 * 60, deliveryDayOffset: 0, deliveryFromMin: 13 * 60, deliveryToMin: 16 * 60, weekdays: [1, 3, 5] };

describe("recurring orders", () => {
  it("lists the runs in the next 7 days, starting tomorrow", () => {
    const days = plannedDays(times, now);
    expect(days.map((d) => d.date)).toEqual(["2026-10-16", "2026-10-19", "2026-10-21"]);
    expect(days[0].pickupFrom.toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(days[0].deliveryTo.toISOString()).toBe("2026-10-16T14:00:00.000Z");
  });

  it("puts delivery on a later day when the template says so", () => {
    const [first] = plannedDays({ ...times, deliveryDayOffset: 1, weekdays: [4] }, now);
    expect(first.date).toBe("2026-10-15");
    expect(first.deliveryFrom.toISOString()).toBe("2026-10-16T11:00:00.000Z");
  });

  it("handles the switch to winter time (25.10.2026)", () => {
    const [sunday] = plannedDays({ ...times, weekdays: [1] }, new Date("2026-10-24T08:00:00Z"));
    expect(sunday.date).toBe("2026-10-26");
    expect(sunday.pickupFrom.toISOString()).toBe("2026-10-26T05:00:00.000Z");
  });

  it("finds the run of one date (used to create orders from keys)", () => {
    expect(runOn(times, "2026-10-16")?.pickupFrom.toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(runOn(times, "2026-10-15")).toBeNull(); // Thursday: not a run day
    expect(runOn(times, "2026-02-30")).toBeNull();
    expect(runOn(times, "16.10.2026")).toBeNull();
    // Just after midnight in Warsaw it is already the next day (22:30 UTC on the 14th).
    expect(warsawDate(new Date("2026-10-14T22:30:00Z"))).toBe("2026-10-15");
  });

  it("turns the best candidate into a forecast", () => {
    const min = 60_000;
    const w = { pickupToMs: 60 * min, deliveryToMs: 600 * min };
    expect(forecastState(undefined, w)).toBe("brak_kierowcy");
    expect(forecastState({ tier: "excluded", pickupEtaMs: null }, w)).toBe("brak_kierowcy");
    expect(forecastState({ tier: "high", pickupEtaMs: 0, deliveryEtaMs: 300 * min }, w)).toBe("zdazy");
    expect(forecastState({ tier: "low", pickupEtaMs: 0, deliveryEtaMs: 300 * min }, w)).toBe("zdazy");
    expect(forecastState({ tier: "medium", pickupEtaMs: 40 * min, deliveryEtaMs: 300 * min }, w)).toBe("ryzyko");
    // Plenty of time at loading, but unloading only 10 minutes before the window closes.
    expect(forecastState({ tier: "high", pickupEtaMs: 0, deliveryEtaMs: 590 * min }, w)).toBe("ryzyko");
  });
});
