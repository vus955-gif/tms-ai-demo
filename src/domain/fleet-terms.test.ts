import { describe, expect, it } from "vitest";
import { absenceReasons, blockingReasons, renewTerm, termStatus } from "./fleet-terms";

const now = new Date("2026-10-14T08:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
const fmt = (d: Date) => d.toISOString().slice(5, 10);

describe("fleet terms", () => {
  it("classifies date and odometer deadlines", () => {
    expect(termStatus({ dueSim: day(90), dueKm: null }, now, null)).toBe("ok");
    expect(termStatus({ dueSim: day(9), dueKm: null }, now, null)).toBe("wkrotce");
    expect(termStatus({ dueSim: day(-1), dueKm: null }, now, null)).toBe("po_terminie");
    expect(termStatus({ dueSim: null, dueKm: 346_400 }, now, 344_600)).toBe("wkrotce");
    expect(termStatus({ dueSim: null, dueKm: 500_000 }, now, 501_200)).toBe("po_terminie");
    expect(termStatus({ dueSim: null, dueKm: 400_000 }, now, 300_000)).toBe("ok");
  });

  it("renews by months or by service interval", () => {
    expect(renewTerm({ kind: "przeglad", dueSim: day(-1), dueKm: null, blocking: true }, now, 0, 0).dueSim!.toISOString()).toBe("2027-10-14T08:00:00.000Z");
    expect(renewTerm({ kind: "tachograf", dueSim: day(5), dueKm: null, blocking: true }, now, 0, 0).dueSim!.getUTCFullYear()).toBe(2028);
    expect(renewTerm({ kind: "serwis", dueSim: null, dueKm: 500_000, blocking: false }, now, 501_200, 100_000)).toEqual({ dueSim: null, dueKm: 601_200 });
  });

  it("blocks only blocking terms that lapse before the order starts", () => {
    const terms = [
      { kind: "przeglad" as const, dueSim: day(2), dueKm: null, blocking: true },
      { kind: "serwis" as const, dueSim: null, dueKm: 1, blocking: false },
      { kind: "oc" as const, dueSim: day(10), dueKm: null, blocking: true },
    ];
    expect(blockingReasons(terms, day(1), fmt)).toEqual([]);
    expect(blockingReasons(terms, day(3), fmt)).toEqual(["badanie techniczne ważne tylko do 10-16"]);
  });

  it("finds absences overlapping the order", () => {
    const abs = [{ kind: "urlop" as const, fromSim: day(1), toSim: day(3) }];
    expect(absenceReasons(abs, day(0), day(0.5), fmt)).toEqual([]);
    expect(absenceReasons(abs, day(2), day(2.2), fmt)).toEqual(["urlop 10-15–10-17"]);
  });
});
