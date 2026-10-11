import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import { messages } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { createLink, extendLink, publicTracking, revokeLink, sharedWithClient, trackingState, trackingWindow } from "./links";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("stage 5: client tracking links", () => {
  let db: Db;
  let sandbox: SandboxRow;

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "tracking", realNow: realStart });
    await runTick(db, sandbox.id, realAt(10));
  });

  it("computes the window from ETD (or earlier departure) to the agreed ETA plus extensions", () => {
    const order = {
      etd: new Date("2026-10-14T08:00:00Z"),
      pickupTo: new Date("2026-10-14T08:00:00Z"),
      departedPickupAt: new Date("2026-10-14T07:30:00Z"),
      etaAgreed: new Date("2026-10-14T14:00:00Z"),
      deliveryTo: new Date("2026-10-14T14:00:00Z"),
    };
    const w = trackingWindow(order, 120);
    expect(w.from.toISOString()).toBe("2026-10-14T07:30:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-14T16:00:00.000Z");
    const link = { revoked: false, extendedMinutes: 0 };
    expect(trackingState(link, order, new Date("2026-10-14T07:00:00Z"))).toBe("przed");
    expect(trackingState(link, order, new Date("2026-10-14T10:00:00Z"))).toBe("aktywny");
    expect(trackingState(link, order, new Date("2026-10-14T15:00:00Z"))).toBe("zakonczony");
    expect(trackingState({ revoked: true, extendedMinutes: 0 }, order, new Date("2026-10-14T10:00:00Z"))).toBe("wylaczony");
  });

  it("shows the client one truck with position and route, and nothing about the driver", async () => {
    const link = await createLink(db, sandbox.id, "zl-1037", atMin(sandbox.simOrigin, 10));
    expect(link.state).toBe("aktywny");
    expect((await createLink(db, sandbox.id, "zl-1037", atMin(sandbox.simOrigin, 11))).token).toBe(link.token);
    const t = await publicTracking(db, link.token, realAt(12));
    expect(t.view).toMatchObject({ number: "ZL-1037", plates: "WB 6P77", status: "w drodze do odbiorcy" });
    expect(t.position).not.toBeNull();
    expect(t.route!.length).toBeGreaterThan(5);
    const json = JSON.stringify(t);
    expect(json).not.toMatch(/Szymański|Paweł|driver|kierowc|\+48/i);
    // Only this truck and its trailer: no other plates anywhere in the response.
    const plates = json.match(/[A-Z]{2,3} [0-9][A-Z0-9]{2,4}/g) ?? [];
    expect(new Set(plates).size).toBeLessThanOrEqual(2);
  });

  it("extends visibility by 2 h and can be switched off", async () => {
    const extended = await extendLink(db, sandbox.id, "zl-1037", atMin(sandbox.simOrigin, 13));
    expect(extended.extendedMinutes).toBe(120);
    const shared = await sharedWithClient(db, sandbox.id, "cl-mazovia", atMin(sandbox.simOrigin, 13));
    expect(shared.map((s) => s.number)).toEqual(["ZL-1037"]);
    expect(await sharedWithClient(db, sandbox.id, "cl-wisla", atMin(sandbox.simOrigin, 13))).toEqual([]);
    await revokeLink(db, sandbox.id, "zl-1037");
    const t = await publicTracking(db, extended.token, realAt(14));
    expect(t).toMatchObject({ state: "wylaczony", view: null, position: null });
  });

  it("rejects unknown and malformed tokens", async () => {
    await expect(publicTracking(db, "../../etc/passwd", realAt(15))).rejects.toThrow(/Nie ma takiego linku/);
    await expect(publicTracking(db, "AAAAAAAAAAAAAAAAAAAAAAAA", realAt(15))).rejects.toThrow(/Nie ma takiego linku/);
  });

  it("puts the live link into the status reply for the client", async () => {
    await createLink(db, sandbox.id, "zl-1037", atMin(sandbox.simOrigin, 20));
    await runTick(db, sandbox.id, realAt(125));
    const drafts = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.state, "draft"), eq(messages.kind, "draft_status")));
    expect(drafts[0].body).toMatch(/Śledzenie na żywo: http:\/\/localhost:3000\/sledzenie\/[A-Za-z0-9_-]{20,}/);
  });
});
