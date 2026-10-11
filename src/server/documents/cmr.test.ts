import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, ParseRequest, ParseResponse } from "@/ai/client";
import { setAiClientForTests } from "@/ai/client";
import type { CmrReading } from "@/ai/functions/read-cmr";
import { alerts, documents, driverClientHistory, messages, orders } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { cmrSample } from "@/simulation/scenario/cmr-samples";
import { createTestDb } from "@/test/db";
import { storeDriverInbound } from "../messages/gateway";
import { processDriverInbound } from "../messages/inbound";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { assignDocument, closeOrderFromDocument, listDocuments, loadSampleImage, openDocumentsCount, rejectDocument } from "./cmr";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

/** Reads a sample the way a good model would: straight from its ground truth. */
function readingFor(sampleId: string): CmrReading {
  const t = cmrSample(sampleId)!.truth;
  return {
    legible: t.legible,
    cmr_number: t.cmrNumber,
    sender: t.sender,
    consignee: t.consignee,
    place_of_delivery: t.placeOfDelivery,
    delivery_date: null,
    goods: t.goods,
    packages: t.packages,
    weight_kg: t.weightKg,
    references: t.references,
    consignee_stamp: t.stamp,
    consignee_signature: t.signature,
    remarks: t.remarks,
  };
}

/** Answers classification with "dokument" and CMR reading with the given sample's truth. */
function scriptedAi(sampleId: () => string): AiClient & { cmrCalls: number } {
  const client = {
    cmrCalls: 0,
    async parse<T>(request: ParseRequest<T>): Promise<ParseResponse<T>> {
      const isCmr = request.system.includes("listów przewozowych CMR");
      if (isCmr) client.cmrCalls++;
      const parsed = isCmr
        ? readingFor(sampleId())
        : { category: "dokument", subtype: null, priority: "normalny", summary: "Kierowca przesłał CMR.", suggested_replies: ["Dzięki"], confidence: 0.95 };
      return { parsed: parsed as T, stopReason: "end_turn", inputTokens: 1500, outputTokens: 200 };
    },
    async capabilities() {
      return { imageInput: true, structuredOutputs: true };
    },
  };
  return client;
}

describe("stage 3: CMR documents", () => {
  let db: Db;
  const order = async (sandbox: SandboxRow, id: string) => (await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id))))[0];
  const docs = (sandbox: SandboxRow) => db.select().from(documents).where(eq(documents.sandboxId, sandbox.id)).orderBy(asc(documents.createdSim));
  const smsTo = (sandbox: SandboxRow, driverId: string) =>
    db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.driverId, driverId), eq(messages.direction, "out")));

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterEach(() => setAiClientForTests(undefined));

  it("ships a readable image for every scenario sample", () => {
    const img = loadSampleImage("zl-1033-ostry");
    expect(img?.mediaType).toBe("image/jpeg");
    expect(img!.data.length).toBeGreaterThan(10_000);
    expect(loadSampleImage("../../package.json")).toBeNull();
  });

  describe("without AI", () => {
    let sandbox: SandboxRow;
    beforeAll(async () => {
      setAiClientForTests(null);
      sandbox = await createSandbox(db, { ipHash: "cmr-noai", realNow: realStart });
      // Events scheduled by a tick's phases run on the next tick (the app polls every 15 s).
      await runTick(db, sandbox.id, realAt(200));
      await runTick(db, sandbox.id, realAt(210));
    });

    it("parks the bot's CMR for manual checking and lets the dispatcher assign and close it", async () => {
      const [doc] = await docs(sandbox);
      expect(doc.imageRef).toBe("zl-1033-ostry");
      expect(doc.status).toBe("do_weryfikacji");
      expect(doc.readBy).toBe("fallback");
      expect(await openDocumentsCount(db, sandbox.id)).toBe(1);

      const view = (await listDocuments(db, sandbox.id))[0];
      expect(view.imageUrl).toBe("/cmr-samples/zl-1033-ostry.jpg");
      expect(view.assignable[0]).toMatchObject({ id: "zl-1033", label: "ZL-1033 (ten kierowca)" });

      const simNow = sandbox.simOrigin;
      await assignDocument(db, sandbox.id, doc.id, "zl-1033", new Date(simNow.getTime() + 211 * 60_000));
      expect((await order(sandbox, "zl-1033")).status).toBe("DO_ZAMKNIECIA");
      await closeOrderFromDocument(db, sandbox.id, doc.id, new Date(simNow.getTime() + 212 * 60_000));
      expect((await order(sandbox, "zl-1033")).status).toBe("ZAMKNIETE");
      expect((await docs(sandbox))[0].status).toBe("zatwierdzony");
      const history = await db.select().from(driverClientHistory).where(and(eq(driverClientHistory.sandboxId, sandbox.id), eq(driverClientHistory.driverId, "d-zielinski")));
      expect(history[0]?.completedOrders).toBeGreaterThanOrEqual(1);
      expect(await openDocumentsCount(db, sandbox.id)).toBe(0);
      const cmrAlerts = await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "cmr")));
      expect(cmrAlerts.every((a) => a.status === "resolved")).toBe(true);
    });

    it("does not nag a driver who already sent a document", async () => {
      await runTick(db, sandbox.id, realAt(440));
      expect((await smsTo(sandbox, "d-zielinski")).some((m) => m.kind === "cmr_missing")).toBe(false);
      const missing = await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "cmr_missing")));
      expect(missing.map((a) => a.title)).not.toContain("ZL-1033: brak CMR");
    });

    it("reminds and then alerts when a driver stays silent", async () => {
      // ZL-1040's driver sends nothing in the default world (seeded 10% "silent" roll).
      expect((await smsTo(sandbox, "d-mazur")).some((m) => m.kind === "cmr_missing")).toBe(true);
      const missing = await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "cmr_missing")));
      expect(missing.map((a) => a.title)).toContain("ZL-1040: brak CMR");
    });
  });

  describe("with AI", () => {
    let sandbox: SandboxRow;
    beforeAll(async () => {
      setAiClientForTests(null);
      sandbox = await createSandbox(db, { ipHash: "cmr-ai", realNow: realStart });
      // ZL-1033 is unloading at T+130; its driver's bot photo comes later.
      await runTick(db, sandbox.id, realAt(130));
    });

    const send = async (driverId: string, sampleId: string, minute: number) => {
      const simNow = new Date(sandbox.simOrigin.getTime() + minute * 60_000);
      const id = await storeDriverInbound(db, sandbox.id, { driverId, body: "CMR", atSim: simNow, attachments: [{ sampleId }] });
      await processDriverInbound(db, sandbox.id, id, { simNow });
    };

    it("asks for a new photo when the CMR is blurry", async () => {
      expect((await order(sandbox, "zl-1033")).status).toBe("ROZLADUNEK");
      let sample = "zl-1034-rozmazany";
      const ai = scriptedAi(() => sample);
      setAiClientForTests(ai);
      await send("d-zielinski", sample, 131);
      expect(ai.cmrCalls).toBe(1);
      const [doc] = await docs(sandbox);
      expect(doc.status).toBe("nieczytelny");
      expect((await smsTo(sandbox, "d-zielinski")).some((m) => m.kind === "cmr_resend")).toBe(true);
      sample = "zl-1033-ostry";
    });

    it("matches a sharp CMR to the unloaded order and moves it to DO_ZAMKNIECIA", async () => {
      setAiClientForTests(scriptedAi(() => "zl-1033-ostry"));
      await send("d-zielinski", "zl-1033-ostry", 133);
      const doc = (await docs(sandbox)).at(-1)!;
      expect(doc.status).toBe("do_zamkniecia");
      expect(doc.matchedOrderId).toBe("zl-1033");
      expect(doc.matchScore).toBeGreaterThanOrEqual(0.85);
      const o = await order(sandbox, "zl-1033");
      expect(o.status).toBe("DO_ZAMKNIECIA");
      const alert = (await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "cmr")))).at(-1)!;
      expect(alert.title).toBe("ZL-1033: CMR gotowy do zamknięcia");
    });

    it("rejecting a wrong match puts the order back to unloading", async () => {
      const doc = (await docs(sandbox)).at(-1)!;
      await rejectDocument(db, sandbox.id, doc.id, new Date(sandbox.simOrigin.getTime() + 134 * 60_000));
      expect((await order(sandbox, "zl-1033")).status).toBe("ROZLADUNEK");
      await expect(closeOrderFromDocument(db, sandbox.id, doc.id, new Date())).rejects.toThrow(/nie czeka/);
    });

    it("flags a CMR without the consignee's stamp before closing", async () => {
      setAiClientForTests(scriptedAi(() => "zl-1031-bez-pieczatki"));
      // Pretend ZL-1033's driver sent ZL-1031's paper: no candidate fits, so it waits for a human.
      await send("d-zielinski", "zl-1031-bez-pieczatki", 135);
      const doc = (await docs(sandbox)).at(-1)!;
      expect(doc.status).toBe("do_weryfikacji");
      expect(doc.quality?.stamp).toBe(false);
      expect(doc.matchedOrderId).toBeNull();
    });
  });
});
