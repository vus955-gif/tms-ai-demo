import { describe, expect, it } from "vitest";
import { durationLabel, historyEntries, historySummary, sortChanges, type StatusChange } from "./order-history";

const at = (min: number) => new Date(Date.UTC(2026, 9, 14, 6, 30) + min * 60_000);

const change = (id: string, fromStatus: StatusChange["fromStatus"], toStatus: StatusChange["toStatus"], min: number, actor: StatusChange["actor"] = "system", reason = ""): StatusChange => ({
  id,
  fromStatus,
  toStatus,
  actor,
  reason,
  atSim: at(min),
});

describe("order history", () => {
  it("orders changes by time and, within one moment, along the status chain", () => {
    // Assignment and the order SMS are written in the same step, with random ids: the database may return them either way.
    const shuffled = [
      change("c", "PRZYPISANE", "WYSLANE", 20),
      change("d", "WYSLANE", "POTWIERDZONE", 32, "ai"),
      change("b", "NOWE", "PRZYPISANE", 20, "dispatcher"),
      change("a", null, "NOWE", 0),
    ];
    expect(sortChanges(shuffled).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the creating entry first even when the next change shares its timestamp", () => {
    const sorted = sortChanges([change("b", "NOWE", "PRZYPISANE", 0), change("a", null, "NOWE", 0)]);
    expect(sorted.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("labels each entry and marks steps back, closing and cancelling", () => {
    const entries = historyEntries([
      change("a", null, "NOWE", 0, "dispatcher", "Zlecenie założone przez spedytora"),
      change("b", "NOWE", "PRZYPISANE", 10, "dispatcher"),
      change("c", "PRZYPISANE", "WYSLANE", 10),
      change("d", "WYSLANE", "NOWE", 16, "system", "Odmowa kierowcy: nie dam rady"),
      change("e", "NOWE", "ANULOWANE", 200, "dispatcher"),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["start", "forward", "forward", "back", "cancelled"]);
    expect(entries[0]).toMatchObject({ from: null, to: "Nowe", actorLabel: "spedytor", sincePrevMin: null });
    expect(entries[3]).toMatchObject({ from: "Wysłane do kierowcy", to: "Nowe", actorLabel: "system", sincePrevMin: 6, reason: "Odmowa kierowcy: nie dam rady" });
    expect(historySummary(entries)).toEqual({ totalMin: 200, stepsBack: 1 });
  });

  it("marks closing and has no total for a single entry", () => {
    const entries = historyEntries([change("z", "DO_ZAMKNIECIA", "ZAMKNIETE", 0, "dispatcher")]);
    expect(entries[0].kind).toBe("closed");
    expect(historySummary(entries)).toEqual({ totalMin: null, stepsBack: 0 });
  });

  it("writes durations the way people say them", () => {
    expect(durationLabel(0)).toBe("0 min");
    expect(durationLabel(35)).toBe("35 min");
    expect(durationLabel(120)).toBe("2 h");
    expect(durationLabel(135)).toBe("2 h 15 min");
    expect(durationLabel(24 * 60)).toBe("1 d");
    expect(durationLabel(28 * 60 + 10)).toBe("1 d 4 h");
  });
});
