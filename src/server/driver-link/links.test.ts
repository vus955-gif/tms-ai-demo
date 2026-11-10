import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { alerts, driverLinks, messages, orders, orderStatusChanges } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { HttpError } from "../http";
import { assignOrder, unassignOrder } from "../orders/assign";
import { approveDraftOrder } from "../orders/drafts";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { cmrByDriver, confirmByDriver, driverOrderView, refuseByDriver } from "./links";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("A6: the driver's order page (link in the order SMS)", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const order = async (id: string) => (await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id))))[0];
  const thread = (driverId: string) =>
    db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.driverId, driverId))).orderBy(asc(messages.atSim));
  const tokenFor = async (orderId: string, driverId: string) => {
    const links = await db.select().from(driverLinks).where(and(eq(driverLinks.sandboxId, sandbox.id), eq(driverLinks.orderId, orderId), eq(driverLinks.driverId, driverId)));
    return links.at(-1)!.token;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "test", realNow: realStart });
  });

  it("puts a link to the driver's page into the order SMS, above the SMS fallback", async () => {
    // ZL-1042 goes to the van driver by script at minute 50; his scripted refusal would come at minute 56.
    await runTick(db, sandbox.id, realAt(52));
    expect((await order("zl-1042")).status).toBe("WYSLANE");
    const sms = (await thread("d-grabowski")).find((m) => m.kind === "order")!;
    const token = await tokenFor("zl-1042", "d-grabowski");
    expect(sms.body).toContain(`Szczegóły i potwierdzenie jednym kliknięciem: http://localhost:3000/k/${token}`);
    expect(sms.body.trim().endsWith("Potwierdź odpisując OK.")).toBe(true);
  });

  it("shows the driver this one order and nothing about other drivers", async () => {
    const view = await driverOrderView(db, await tokenFor("zl-1042", "d-grabowski"), realAt(52));
    expect(view).toMatchObject({ number: "ZL-1042", state: "do_potwierdzenia", cmr: "brak", samples: [] });
    expect(view.pickup.window).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
    expect(view.pickup.city).not.toBe("");
    expect(view.delivery.lat).not.toBe(0);
    expect(JSON.stringify(view)).not.toMatch(/d-grabowski|phone|@/);
  });

  it("confirms with one tap: status by the driver, a message in the thread and an info alert — without AI", async () => {
    const token = await tokenFor("zl-1042", "d-grabowski");
    const view = await confirmByDriver(db, token, realAt(53));
    expect(view.state).toBe("potwierdzone");
    expect((await order("zl-1042")).status).toBe("POTWIERDZONE");
    const [change] = (await db.select().from(orderStatusChanges).where(and(eq(orderStatusChanges.sandboxId, sandbox.id), eq(orderStatusChanges.orderId, "zl-1042")))).filter((c) => c.toStatus === "POTWIERDZONE");
    expect(change).toMatchObject({ actor: "driver", reason: "Kierowca potwierdził na stronie zlecenia" });
    const last = (await thread("d-grabowski")).at(-1)!;
    expect(last).toMatchObject({ direction: "in", aiCategory: "potwierdzenie", classifiedBy: "rules", orderId: "zl-1042" });
    expect(last.body).toContain("Potwierdzam zlecenie ZL-1042");
    const confirmed = await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "order_confirmed"), eq(alerts.orderId, "zl-1042")));
    expect(confirmed).toHaveLength(1);

    // A second tap changes nothing and is not an error for the driver.
    const again = await confirmByDriver(db, token, realAt(53));
    expect(again.state).toBe("potwierdzone");
    expect((await thread("d-grabowski")).filter((m) => m.body.includes("Potwierdzam zlecenie"))).toHaveLength(1);
    // Refusing after confirming is a phone call, not a button.
    await expect(refuseByDriver(db, token, "Auto niesprawne", realAt(53))).rejects.toThrow(HttpError);

    // The scripted bot reply (a refusal at minute 56) no longer applies: the order stays confirmed.
    await runTick(db, sandbox.id, realAt(57));
    expect((await order("zl-1042")).status).toBe("POTWIERDZONE");
  });

  it("refusal returns the order to the pool with the reason; a taken-back link says only that the order is off", async () => {
    const at = (await runTick(db, sandbox.id, realAt(58))).simNow;
    await approveDraftOrder(db, sandbox.id, "zl-1043", null, at);
    await assignOrder(db, sandbox.id, "zl-1043", "d-piotrowska", { actor: "dispatcher", simNow: at, replyAfterMin: 600 });
    const first = await tokenFor("zl-1043", "d-piotrowska");
    const refused = await refuseByDriver(db, first, "Brak czasu pracy", realAt(59));
    expect(refused.state).toBe("odwolane");
    expect(refused.pickup.city).toBe("");
    const pooled = await order("zl-1043");
    expect(pooled).toMatchObject({ status: "NOWE", driverId: null, vehicleId: null });
    const [alert] = await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "order_refused"), eq(alerts.orderId, "zl-1043")));
    expect(alert.body).toContain("Brak czasu pracy");
    expect(alert.actions).toContain("przydziel_innego");

    // Another driver gets the order: the first driver's link stays dead, the new one works.
    const later = (await runTick(db, sandbox.id, realAt(60))).simNow;
    await assignOrder(db, sandbox.id, "zl-1043", "d-dabrowski", { actor: "dispatcher", simNow: later, replyAfterMin: 600 });
    expect((await driverOrderView(db, first, realAt(60))).state).toBe("odwolane");
    await expect(confirmByDriver(db, first, realAt(60))).rejects.toThrow("odwołane");
    const second = await tokenFor("zl-1043", "d-dabrowski");
    expect((await driverOrderView(db, second, realAt(60))).state).toBe("do_potwierdzenia");

    // The dispatcher takes it back: that link dies as well.
    await unassignOrder(db, sandbox.id, "zl-1043", (await runTick(db, sandbox.id, realAt(61))).simNow);
    expect((await driverOrderView(db, second, realAt(61))).state).toBe("odwolane");
  });

  it("accepts a CMR photo only after unloading and only this order's samples", async () => {
    const token = await tokenFor("zl-1042", "d-grabowski");
    await expect(cmrByDriver(db, token, { sampleId: "zl-1031-ostry" }, realAt(62))).rejects.toThrow("po rozładunku");
  });

  it("answers unknown and malformed tokens with 404, not with data", async () => {
    await expect(driverOrderView(db, "nie-ma-takiego-tokenu-1234", realAt(62))).rejects.toMatchObject({ status: 404 });
    await expect(driverOrderView(db, "../../etc/passwd", realAt(62))).rejects.toMatchObject({ status: 404 });
  });
});
