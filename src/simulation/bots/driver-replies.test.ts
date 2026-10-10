import { describe, expect, it } from "vitest";
import { createRng } from "../random";
import { botReplyDelayMin, chooseBotReply } from "./driver-replies";

describe("driver bots", () => {
  it("is deterministic for the same seed", () => {
    expect(chooseBotReply(createRng(5), 0.1)).toEqual(chooseBotReply(createRng(5), 0.1));
  });

  it("honours a forced reply", () => {
    const r = chooseBotReply(createRng(1), 0, "refusal");
    expect(r.kind).toBe("refusal");
    expect(r.text).toBeTruthy();
  });

  it("refuses much more often with a high propensity (van drivers)", () => {
    const count = (p: number) => {
      const rng = createRng(42);
      let refusals = 0;
      for (let i = 0; i < 2000; i++) if (chooseBotReply(rng, p).kind === "refusal") refusals++;
      return refusals / 2000;
    };
    expect(count(0.5)).toBeGreaterThan(0.35);
    expect(count(0.1)).toBeLessThan(0.15);
  });

  it("answers within 2–15 minutes", () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i++) {
      const d = botReplyDelayMin(rng);
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(15);
    }
  });
});
