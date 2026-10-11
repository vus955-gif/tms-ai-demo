import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { aiLog, alerts, messages, orders, sandboxes } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { revertAiAction } from "../ai-actions";
import { storeDriverInbound } from "../messages/gateway";
import { processDriverInbound } from "../messages/inbound";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { assignOrder, confirmOrder, unassignOrder } from "./assign";
import { assertAssignable, matchOrder, ordersBoard } from "./board";
import { approveDraftOrder } from "./drafts";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("stage 2: orders, SMS and driver replies", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const order = async (id: string) => (await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id))))[0];
  const thread = (driverId: string) =>
    db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.driverId, driverId))).orderBy(asc(messages.atSim));
  const openAlerts = () => db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.status, "open")));
  const tickTo = async (m: number) => (await runTick(db, sandbox.id, realAt(m))).simNow;

  beforeAll(async () => {
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "test", realNow: realStart });
  });

  it("creates the scripted orders and sends ZL-1042 to the van driver", async () => {
    const at = await tickTo(52);
    expect((await order("zl-1042")).status).toBe("WYSLANE");
    // ZL-1043 arrives as a draft from the client's e-mail (stage 3b); the dispatcher approves it.
    expect((await order("zl-1043")).status).toBe("SZKIC");
    await approveDraftOrder(db, sandbox.id, "zl-1043", null, at);
    expect((await order("zl-1043")).status).toBe("NOWE");
    const sms = (await thread("d-grabowski")).find((m) => m.kind === "order")!;
    expect(sms.body).toContain("ZLECENIE ZL-1042");
    expect(sms.body).toContain("Potwierdź odpisując OK.");
  });

  it("puts ZL-1042 back in the pool after the van driver refuses", async () => {
    await tickTo(60);
    expect((await order("zl-1042")).status).toBe("NOWE");
    const reply = (await thread("d-grabowski")).find((m) => m.direction === "in")!;
    expect(reply.aiCategory).toBe("odmowa");
    expect((await openAlerts()).some((a) => a.kind === "order_refused")).toBe(true);
    const board = await ordersBoard(db, sandbox.id);
    expect(board.newOrders.map((o) => o.number)).toEqual(expect.arrayContaining(["ZL-1042", "ZL-1043"]));
  });

  it("offers drivers for ZL-1043 with reasons and excludes vans that are too small", async () => {
    const results = await matchOrder(db, sandbox.id, "zl-1043", (await order("zl-1043")).createdSim);
    const van = results.find((r) => r.plates === "GD 4W63")!;
    expect(van.tier).toBe("excluded");
    expect(van.reasons[0]).toContain("za mała pojemność");
    const best = results[0];
    expect(best.tier).not.toBe("excluded");
    expect(best.reasons.length).toBeGreaterThan(1);
    await expect(assertAssignable(db, sandbox.id, "zl-1043", "d-grabowski", new Date())).rejects.toThrow(/pojemność/);
  });

  it("keeps the order waiting on a conditional yes and confirms on a clean OK", async () => {
    await db.update(sandboxes).set({ phoneDriverId: "d-zielinski" }).where(eq(sandboxes.id, sandbox.id));
    const at = await tickTo(65);
    await db.transaction((tx) => assignOrder(tx, sandbox.id, "zl-1043", "d-zielinski", { actor: "dispatcher", simNow: at }));
    expect((await order("zl-1043")).status).toBe("WYSLANE");

    const conditional = await storeDriverInbound(db, sandbox.id, { driverId: "d-zielinski", body: "ok, ale będę 2 h później", atSim: at });
    const first = await processDriverInbound(db, sandbox.id, conditional, { simNow: at });
    expect(first.category).toBe("warunek_pytanie");
    expect((await order("zl-1043")).status).toBe("WYSLANE");
    expect((await openAlerts()).some((a) => a.messageId === conditional)).toBe(true);

    const ok = await storeDriverInbound(db, sandbox.id, { driverId: "d-zielinski", body: "OK jadę", atSim: at });
    await processDriverInbound(db, sandbox.id, ok, { simNow: at });
    expect((await order("zl-1043")).status).toBe("POTWIERDZONE");

    // The dispatcher can undo the AI's reading from the AI log, once.
    const [entry] = (await db.select().from(aiLog).where(eq(aiLog.sandboxId, sandbox.id))).filter((e) => e.actionTaken);
    expect(JSON.parse(entry.actionTaken!)).toMatchObject({ orderId: "zl-1043", from: "WYSLANE", to: "POTWIERDZONE" });
    await revertAiAction(db, sandbox.id, entry.id, at);
    expect((await order("zl-1043")).status).toBe("WYSLANE");
    await expect(revertAiAction(db, sandbox.id, entry.id, at)).rejects.toThrow(/już cofnięta/);
    await confirmOrder(db, sandbox.id, "zl-1043", at);
    expect((await order("zl-1043")).status).toBe("POTWIERDZONE");
  });

  it("reminds a silent driver and then alerts the dispatcher", async () => {
    await db.update(sandboxes).set({ phoneDriverId: "d-piotrowska" }).where(eq(sandboxes.id, sandbox.id));
    const at = await tickTo(70);
    // Piotrowska drives a small van; ZL-1042 (6 pallets) fits.
    await db.transaction((tx) => assignOrder(tx, sandbox.id, "zl-1042", "d-piotrowska", { actor: "dispatcher", simNow: at }));
    await tickTo(70 + 21);
    expect((await thread("d-piotrowska")).some((m) => m.kind === "reminder")).toBe(true);
    await tickTo(70 + 41);
    expect((await openAlerts()).some((a) => a.kind === "no_reply" && a.orderId === "zl-1042")).toBe(true);
  });

  it("takes the order back with a cancellation SMS", async () => {
    const at = await tickTo(115);
    await db.transaction((tx) => unassignOrder(tx, sandbox.id, "zl-1042", at));
    expect((await order("zl-1042")).status).toBe("NOWE");
    expect((await order("zl-1042")).driverId).toBeNull();
    expect((await thread("d-piotrowska")).at(-1)!.kind).toBe("cancellation");
  });
});
