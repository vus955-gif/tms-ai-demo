import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { orders, sandboxes, vehicles } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { hashIp, isValidSandboxId } from "./cookie";
import { cleanupExpired, createSandbox, getOrCreateSandbox, resetSandbox } from "./repository";

const now = new Date("2026-10-14T10:00:00Z");
const ip = hashIp("203.0.113.7");

describe("sandbox repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("seeds the whole scenario into a new world", async () => {
    const sandbox = await createSandbox(db, { ipHash: ip, realNow: now });
    expect(isValidSandboxId(sandbox.id)).toBe(true);
    expect(sandbox.simOrigin).toEqual(new Date("2026-10-14T06:30:00Z"));
    expect(sandbox.speed).toBe(10);
    const fleet = await db.select().from(vehicles).where(eq(vehicles.sandboxId, sandbox.id));
    expect(fleet).toHaveLength(14);
    const active = await db.select().from(orders).where(eq(orders.sandboxId, sandbox.id));
    expect(active).toHaveLength(11);
    expect(active.find((o) => o.id === "zl-1031")!.trailerId).toBe("tr-po77n3");
  });

  it("returns the same world for the same cookie", async () => {
    const first = await getOrCreateSandbox(db, { cookieValue: undefined, ipHash: ip, realNow: now });
    expect(first.created).toBe(true);
    const later = new Date(now.getTime() + 60_000);
    const second = await getOrCreateSandbox(db, { cookieValue: first.sandbox.id, ipHash: ip, realNow: later });
    expect(second.created).toBe(false);
    expect(second.sandbox.id).toBe(first.sandbox.id);
    expect(second.sandbox.lastSeenAt).toEqual(later);
  });

  it("creates a new world for a malformed or unknown cookie", async () => {
    const garbage = await getOrCreateSandbox(db, { cookieValue: "'; drop table x; --", ipHash: ip, realNow: now });
    expect(garbage.created).toBe(true);
    const unknown = await getOrCreateSandbox(db, {
      cookieValue: "00000000-0000-4000-8000-000000000000",
      ipHash: ip,
      realNow: now,
    });
    expect(unknown.created).toBe(true);
    expect(unknown.sandbox.id).not.toBe("00000000-0000-4000-8000-000000000000");
  });

  it("creates a new world when the old one has expired", async () => {
    const first = await getOrCreateSandbox(db, { cookieValue: undefined, ipHash: ip, realNow: now });
    const muchLater = new Date(now.getTime() + 25 * 3_600_000);
    const next = await getOrCreateSandbox(db, { cookieValue: first.sandbox.id, ipHash: ip, realNow: muchLater });
    expect(next.created).toBe(true);
    expect(next.sandbox.id).not.toBe(first.sandbox.id);
  });

  it("recycles the oldest world once an address hits the daily limit", async () => {
    process.env.SANDBOXES_PER_IP_PER_DAY = "2";
    try {
      const a = await createSandbox(db, { ipHash: ip, realNow: now });
      await createSandbox(db, { ipHash: ip, realNow: new Date(now.getTime() + 1000) });
      const third = await getOrCreateSandbox(db, { cookieValue: undefined, ipHash: ip, realNow: new Date(now.getTime() + 2000) });
      expect(third.created).toBe(true);
      expect(third.sandbox.id).toBe(a.id);
      const all = await db.select().from(sandboxes);
      expect(all).toHaveLength(2);
    } finally {
      delete process.env.SANDBOXES_PER_IP_PER_DAY;
    }
  });

  it("resets a world to its initial state under the same id", async () => {
    const sandbox = await createSandbox(db, { ipHash: ip, realNow: now });
    await db.update(orders).set({ status: "ANULOWANE" }).where(eq(orders.sandboxId, sandbox.id));
    const later = new Date(now.getTime() + 3_600_000);
    const reset = await resetSandbox(db, sandbox.id, later);
    expect(reset.id).toBe(sandbox.id);
    const fresh = await db.select().from(orders).where(eq(orders.sandboxId, sandbox.id));
    expect(fresh.every((o) => o.status !== "ANULOWANE")).toBe(true);
    expect(reset.realResumedAt).toEqual(later);
  });

  it("removes expired worlds, at most `limit` at a time", async () => {
    for (let i = 0; i < 3; i++) await createSandbox(db, { ipHash: ip, realNow: now });
    const afterExpiry = new Date(now.getTime() + 25 * 3_600_000);
    expect(await cleanupExpired(db, afterExpiry, 2)).toBe(2);
    expect(await db.select().from(sandboxes)).toHaveLength(1);
    expect(await cleanupExpired(db, afterExpiry, 2)).toBe(1);
  });
});
