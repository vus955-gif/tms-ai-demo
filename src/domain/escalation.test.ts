import { describe, expect, it } from "vitest";
import { escalationTimes } from "./escalation";

const M = 60_000;

describe("escalationTimes", () => {
  it("reminds after 20 and alerts after 40 minutes by default", () => {
    expect(escalationTimes(0, 5 * 60 * M)).toEqual({ reminderMs: 20 * M, alertMs: 40 * M });
  });

  it("halves the steps when loading starts within two hours", () => {
    expect(escalationTimes(0, 90 * M)).toEqual({ reminderMs: 10 * M, alertMs: 20 * M });
  });
});
