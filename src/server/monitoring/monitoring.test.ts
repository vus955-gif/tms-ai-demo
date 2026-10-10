import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { alerts, driverActivities, orders, vehicleStates } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { buildSnapshot } from "../snapshot";
import { runTick } from "../tick/engine";
import { applyReroute, vehicleDetail } from "./vehicle-detail";

const realStart = new Date("2026-10-14T06:00:00Z");
/** Real time at which the default 10x clock reaches `simMinutes`. */
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("stage 1 monitoring on the demo scenario", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const order = async (id: string) =>
    (await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id))))[0];
  const state = async (vehicleId: string) =>
    (await db.select().from(vehicleStates).where(and(eq(vehicleStates.sandboxId, sandbox.id), eq(vehicleStates.vehicleId, vehicleId))))[0];

  beforeAll(async () => {
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "test", realNow: realStart });
  });

  it("starts with every vehicle placed and two drivers due for a break", async () => {
    const tick = await runTick(db, sandbox.id, realAt(0));
    const snapshot = await buildSnapshot(db, tick.sandbox, tick.simNow, realAt(0), tick);
    expect(snapshot.fleet).toHaveLength(14);
    expect(snapshot.fleet.filter((v) => v.risk === "red")).toHaveLength(0);
    expect(snapshot.fleet.filter((v) => v.risk === "yellow").map((v) => v.plates)).toEqual(
      expect.arrayContaining(["PO 2C19", "WB 6P77"]),
    );
    expect(snapshot.fleet.filter((v) => v.risk === "gray").map((v) => v.plates).sort()).toEqual(["DW 1T07", "EL 9K41", "GD 4W63"]);
    const bus = snapshot.fleet.find((v) => v.plates === "EL 3B12")!;
    expect(bus.drivingLeftMin).toBeNull();
  });

  it("raises the A2 accident with a detour and turns PO 4K21 red", async () => {
    const before = await state("v-po4k21");
    await runTick(db, sandbox.id, realAt(30));
    const after = await state("v-po4k21");
    expect(after.progressS).toBeGreaterThan(before.progressS);
    const open = await db.select().from(alerts).where(eq(alerts.sandboxId, sandbox.id));
    const accident = open.find((a) => a.kind === "incident" && a.vehicleId === "v-po4k21");
    expect(accident).toBeDefined();
    expect(accident!.actions).toContain("zastosuj_objazd");
    expect((await order("zl-1031")).risk).toBe("red");
  });

  it("gets PO 4K21 back on time with the detour", async () => {
    const lateEta = (await order("zl-1031")).etaPredicted!;
    const detail = await vehicleDetail(db, sandbox.id, "v-po4k21", (await state("v-po4k21")).lastReportAt!);
    expect(detail.alternatives).toHaveLength(1);
    expect(new Date(detail.alternatives[0].eta!).getTime()).toBeLessThan(lateEta.getTime());
    await applyReroute(db, sandbox.id, "v-po4k21", detail.alternatives[0].key);
    await runTick(db, sandbox.id, realAt(32));
    const rerouted = await order("zl-1031");
    expect(rerouted.etaPredicted!.getTime()).toBeLessThan(lateEta.getTime());
    expect(rerouted.risk).not.toBe("red");
  });

  it("catches up hours at once: ramp wait makes GD 2M88 red, GPS drives the statuses", async () => {
    const result = await runTick(db, sandbox.id, realAt(300));
    expect(result.remaining).toBe(0);
    expect((await order("zl-1032")).risk).toBe("red");
    const bus = await order("zl-1040");
    expect(bus.status).toBe("ROZLADUNEK");
    expect(bus.unloadedAt).not.toBeNull();
    const berlin = await order("zl-1031");
    expect(["ROZLADUNEK"]).toContain(berlin.status);
    expect(berlin.risk).toBeNull();
  });

  it("keeps each driver's activity history contiguous and without overlaps", async () => {
    const rows = await db
      .select()
      .from(driverActivities)
      .where(and(eq(driverActivities.sandboxId, sandbox.id), eq(driverActivities.driverId, "d-wisniewska")))
      .orderBy(asc(driverActivities.startSim));
    expect(rows.filter((r) => r.endSim === null)).toHaveLength(1);
    for (let i = 1; i < rows.length; i++) expect(rows[i].startSim.getTime()).toBe(rows[i - 1].endSim!.getTime());
    expect(rows.some((r) => r.type === "break" && r.source === "plan")).toBe(true);
  });
});
