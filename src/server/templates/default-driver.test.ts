import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import { messages, orders } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { fakeAiClient, ok } from "@/test/fake-ai";
import { cancelOrder, unassignOrder } from "../orders/assign";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { adviseRun, createPlanned, weekPlan } from "./templates";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("A3: usual driver of a template, order SMS the day before, advice for red days", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  const order = async (number: string) => (await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.number, number))))[0];
  const smsTo = async (driverId: string, orderId: string) =>
    db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.driverId, driverId), eq(messages.orderId, orderId)));
  /** Ticks until the world reaches the minute (catching up the scenario's events). */
  const advance = async (minute: number) => {
    for (let i = 0; i < 100; i++) if ((await runTick(db, sandbox.id, realAt(minute))).remaining === 0) return;
    throw new Error("world did not catch up");
  };

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "a3", realNow: realStart });
    await advance(10);
  });

  it("shows the usual driver in the plan: Anna can take Monday's reefer run, Adam cannot (tachograph)", async () => {
    const plan = await weekPlan(db, sandbox, at(10));
    const baltic = plan.find((p) => p.key === "tpl-baltic-chlodnia:2026-10-19")!;
    expect(baltic).toMatchObject({ defaultDriver: { name: "Anna Wiśniewska", ok: true }, assignsDefault: true, bestDriver: "Anna Wiśniewska" });
    const agro = plan.find((p) => p.key === "tpl-agropol-pasza:2026-10-16")!;
    expect(agro.defaultDriver).toMatchObject({ name: "Adam Dąbrowski", ok: false });
    expect(agro.defaultDriver!.reason).toMatch(/tachograf/);
    expect(agro.assignsDefault).toBe(false);
    expect(agro.bestDriver).not.toBe("Adam Dąbrowski");
  });

  it("assigns the run to the usual driver and sends the order SMS at 16:00 the day before, not now", async () => {
    const { created } = await createPlanned(db, sandbox, ["tpl-baltic-chlodnia:2026-10-19", "tpl-agropol-pasza:2026-10-16"], at(11));
    const baltic = created.find((c) => c.driverName === "Anna Wiśniewska")!;
    expect(baltic.smsAt).toBe(new Date("2026-10-18T14:00:00Z").toISOString());
    const agro = created.find((c) => c.driverName === null)!;
    expect(agro.notAssigned).toMatch(/tachograf/);

    const row = await order(baltic.number);
    expect(row).toMatchObject({ status: "PRZYPISANE", driverId: "d-wisniewska" });
    expect(row.smsDueSim?.toISOString()).toBe(baltic.smsAt);
    expect(await smsTo("d-wisniewska", row.id)).toHaveLength(0);
    expect((await order(agro.number)).status).toBe("NOWE");
  });

  it("does not give a driver a run that overlaps one assigned to them a moment ago (SMS not out yet)", async () => {
    // Monday: Anna already has the reefer run 05:00–14:00 (PRZYPISANE); the feed run 06:00–16:00 the same day would clash.
    const { created } = await createPlanned(db, sandbox, [{ key: "tpl-agropol-pasza:2026-10-19", driverId: "d-wisniewska" }], at(11));
    expect(created[0]).toMatchObject({ driverName: null, notAssigned: expect.stringMatching(/kierowca ma już w tym czasie ZL-\d+/) });
    expect((await order(created[0].number)).status).toBe("NOWE");
  });

  it("taking the order back before the SMS leaves the driver in peace; the scheduled SMS then does nothing", async () => {
    const { created } = await createPlanned(db, sandbox, ["tpl-baltic-chlodnia:2026-10-20"], at(12));
    const row = await order(created[0].number);
    expect(row.status).toBe("PRZYPISANE");
    await unassignOrder(db, sandbox.id, row.id, at(13));
    expect(await smsTo("d-wisniewska", row.id)).toHaveLength(0);
    expect((await order(created[0].number)).smsDueSim).toBeNull();
  });

  it("“od razu” sends the order SMS now", async () => {
    // The day is freed by cancelling the order taken back above.
    const [freed] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.templateKey, "tpl-baltic-chlodnia:2026-10-20")));
    await cancelOrder(db, sandbox.id, freed.id, at(14));
    const { created } = await createPlanned(db, sandbox, [{ key: "tpl-baltic-chlodnia:2026-10-20" }], at(14), { sms: "od_razu" });
    const row = await order(created[0].number);
    expect(row.status).toBe("WYSLANE");
    expect((await smsTo("d-wisniewska", row.id)).map((m) => m.kind)).toEqual(["order"]);
  });

  it("the scheduled SMS goes out on time the day before", async () => {
    const monday = await order((await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.templateKey, "tpl-baltic-chlodnia:2026-10-19"))))[0].number);
    const dueMin = (monday.smsDueSim!.getTime() - sandbox.simOrigin.getTime()) / 60_000;
    await advance(dueMin + 5);
    const after = await order(monday.number);
    expect(after.status === "WYSLANE" || after.status === "POTWIERDZONE").toBe(true);
    const sms = await smsTo("d-wisniewska", monday.id);
    expect(sms[0]).toMatchObject({ kind: "order" });
    expect(sms[0].atSim.toISOString()).toBe(monday.smsDueSim!.toISOString());
  });

  it("the SMS planned for an order taken back and cancelled never goes out", async () => {
    const [cancelled] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.templateKey, "tpl-baltic-chlodnia:2026-10-20"), eq(orders.status, "ANULOWANE")));
    // Its SMS was due on Monday 19.10 at 16:00.
    await advance((new Date("2026-10-19T14:05:00Z").getTime() - sandbox.simOrigin.getTime()) / 60_000);
    expect(await smsTo("d-wisniewska", cancelled.id)).toHaveLength(0);
    expect((await order(cancelled.number)).status).toBe("ANULOWANE");
  });

  it("advises on a red day from the algorithm's facts (rules without AI)", async () => {
    // Wednesday 21: the only reefer's ATP lapses — nobody can take the chilled run.
    const red = await adviseRun(db, sandbox, "tpl-baltic-chlodnia:2026-10-21", at(15));
    expect(red.source).toBe("fallback");
    expect(red.summary).toMatch(/nikt nie może|brak pojazdu/);
    const agro = await adviseRun(db, sandbox, "tpl-agropol-pasza:2026-10-21", at(15));
    expect(agro.summary).toMatch(/Zwykły kierowca Adam Dąbrowski nie może/);
  });

  it("drops an AI suggestion of a driver the algorithm did not list, and falls back to the rules", async () => {
    try {
      setAiClientForTests(fakeAiClient([ok({ summary: "Weź kierowcę spoza listy.", options: [{ kind: "inny_kierowca", text: "Przydziel Jana Kowalskiego", driver_id: "d-nobody" }] })]));
      const advice = await adviseRun(db, sandbox, "tpl-agropol-pasza:2026-10-21", at(16));
      expect(advice.source).toBe("fallback");
      expect(advice.options.every((o) => o.kind !== "inny_kierowca" || advice.candidates.some((c) => c.driverId === o.driverId))).toBe(true);
    } finally {
      setAiClientForTests(null);
    }
  });
});
