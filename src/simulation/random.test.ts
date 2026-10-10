import { describe, expect, it } from "vitest";
import { createRng, seedFromString } from "./random";

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("differs between seeds", () => {
    expect(createRng(1).next()).not.toEqual(createRng(2).next());
  });

  it("returns values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("keeps int() within inclusive bounds and hits both ends", () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it("treats chance(0) and chance(1) as never and always", () => {
    const rng = createRng(9);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("picks only existing items and rejects an empty list", () => {
    const rng = createRng(11);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });
});

describe("seedFromString", () => {
  it("is stable and spreads different strings", () => {
    expect(seedFromString("sandbox-1")).toBe(seedFromString("sandbox-1"));
    expect(seedFromString("sandbox-1")).not.toBe(seedFromString("sandbox-2"));
  });
});
