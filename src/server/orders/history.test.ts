import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { HttpError } from "../http";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { orderHistory } from "./history";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("order history", () => {
  let db: Db;
  let sandbox: SandboxRow;

  beforeAll(async () => {
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "test", realNow: realStart });
  });

  it("shows the whole life of a run closed before the demo starts", async () => {
    const h = await orderHistory(db, sandbox.id, "zl-1022");
    expect(h).toMatchObject({ number: "ZL-1022", statusLabel: "Zamknięte", clientName: "Meble Wielkopolska Sp. z o.o.", routeLabel: "Swarzędz → Berlin", driverName: "Jan Nowak" });
    expect(h.entries.map((e) => e.status)).toEqual(["NOWE", "PRZYPISANE", "WYSLANE", "POTWIERDZONE", "ZALADUNEK", "W_DRODZE", "ROZLADUNEK", "DO_ZAMKNIECIA", "ZAMKNIETE"]);
    expect(h.entries[0]).toMatchObject({ kind: "start", from: null, sincePrevMin: null });
    expect(h.entries.at(-1)).toMatchObject({ kind: "closed", from: "Do zamknięcia", actorLabel: "spedytor" });
    // Times never run backwards, and nothing in a finished run is a step back.
    expect(h.entries.every((e) => e.sincePrevMin === null || e.sincePrevMin >= 0)).toBe(true);
    expect(h.summary.stepsBack).toBe(0);
    expect(h.summary.totalMin).toBeGreaterThan(24 * 60);
  });

  it("records a refusal as a step back, in the order things happened", async () => {
    // The scenario creates ZL-1042 and assigns it at minute 50; the simulated van driver refuses a few minutes later.
    await runTick(db, sandbox.id, realAt(52));
    await runTick(db, sandbox.id, realAt(60));
    const h = await orderHistory(db, sandbox.id, "zl-1042");
    expect(h.entries.map((e) => `${e.from ?? "—"} → ${e.to}`)).toEqual(["— → Nowe", "Nowe → Przypisane", "Przypisane → Wysłane do kierowcy", "Wysłane do kierowcy → Nowe"]);
    expect(h.entries.map((e) => e.kind)).toEqual(["start", "forward", "forward", "back"]);
    expect(h.entries[3].reason).toMatch(/^Odmowa kierowcy/);
    expect(h).toMatchObject({ statusLabel: "Nowe", driverName: null, summary: { stepsBack: 1 } });
  });

  it("answers 404 for an order that is not in this world", async () => {
    await expect(orderHistory(db, sandbox.id, "zl-0000")).rejects.toBeInstanceOf(HttpError);
  });
});
