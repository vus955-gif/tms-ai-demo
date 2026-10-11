import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import { agentQuotes, messages, quoteRequests, salesSettings } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { sendDraft } from "../inbox/actions";
import { storeClientInbound } from "../inbox/gateway";
import { processClientEmail } from "../inbox/process";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { approveSending, draftNegotiation, draftOffer, recalcRoad, selectRate, sendAgentDraft, updateDetails } from "./actions";
import { quoteDetail } from "./views";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("Sales: quotes via agents and road quotes", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  const inquiry = async (contactId: string, subject: string, body: string, minute: number) => {
    const id = await storeClientInbound(db, sandbox.id, { contactId, subject, body, atSim: at(minute) });
    await processClientEmail(db, sandbox.id, id, { simNow: at(minute) });
    const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.sourceMessageId, id)));
    return q;
  };

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "sales", realNow: realStart });
    await runTick(db, sandbox.id, realAt(5));
  });

  it("acknowledges a complete sea inquiry and sends anonymous RFQs to sea agents", async () => {
    const q = await inquiry(
      "ct-sudety-1",
      "Wycena — kontener do Chin",
      "Dzień dobry,\nprosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t, gotowe do wysyłki od 25.10.\nLeszek Michalak, Sudety Papier",
      6,
    );
    expect(q).toMatchObject({ number: "WY-1001", mode: "sea", status: "zbieranie", extractedBy: "rules" });
    const view = await quoteDetail(db, sandbox.id, q.id);
    expect(view.missing).toEqual([]);
    expect(view.clientThread.some((m) => m.kind === "quote_ack" && m.body.includes("powrócimy z wyceną"))).toBe(true);
    expect(view.agents.map((a) => a.agentId).sort()).toEqual(["ag-baltic-sea", "ag-gdansk-cargo", "ag-multi", "ag-north-star"]);
    const rfqs = view.agents.flatMap((a) => a.thread).filter((m) => m.kind === "rfq");
    expect(rfqs).toHaveLength(4);
    for (const rfq of rfqs) {
      expect(rfq.body).toContain("Gdańsk → Shanghai");
      expect(rfq.body).not.toMatch(/Sudety|Michalak|sudetypapier/i);
    }
  });

  it("collects rates, reminds silent agents and closes collection at the deadline", async () => {
    await runTick(db, sandbox.id, realAt(200));
    await runTick(db, sandbox.id, realAt(320));
    await runTick(db, sandbox.id, realAt(500));
    const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.number, "WY-1001")));
    const view = await quoteDetail(db, sandbox.id, q.id);
    expect(view.status).toBe("gotowe");
    const priced = view.agents.filter((a) => a.status === "odpowiedz");
    expect(priced.length).toBeGreaterThan(0);
    for (const a of priced) {
      expect(a.currency).toBe("USD");
      expect(a.price).toBeGreaterThan(500);
      expect(a.transitDays).toBeGreaterThan(20);
      expect(a.readBy).toBe("rules");
    }
    expect(view.agents.every((a) => ["odpowiedz", "brak_miejsca", "brak_odpowiedzi"].includes(a.status))).toBe(true);
    const reminded = view.agents.filter((a) => a.thread.some((m) => m.kind === "rfq_reminder"));
    expect(reminded.every((a) => a.thread.some((m) => m.kind === "rfq"))).toBe(true);
  });

  it("turns the chosen rate plus margin into an offer draft and marks it sent", async () => {
    const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.number, "WY-1001")));
    const best = (await quoteDetail(db, sandbox.id, q.id)).agents.find((a) => a.status === "odpowiedz")!;
    await selectRate(db, sandbox.id, q.id, best.agentQuoteId, 12);
    const view = await quoteDetail(db, sandbox.id, q.id);
    expect(view.offer).toEqual({ purchase: best.price, price: Math.ceil(Math.round(best.price! * 1.12 * 100) / 100), currency: "USD" });
    const draftId = await draftOffer(db, sandbox.id, q.id, at(510));
    const [draft] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.id, draftId)));
    expect(draft.body.replace(/\s/g, "")).toContain(String(view.offer!.price));
    await sendDraft(db, sandbox.id, draftId, { subject: draft.subject!, body: draft.body }, at(511));
    expect((await quoteDetail(db, sandbox.id, q.id)).status).toBe("oferta_wyslana");
  });

  it("negotiates with an agent and reads the new rate", async () => {
    const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.number, "WY-1001")));
    const agent = (await quoteDetail(db, sandbox.id, q.id)).agents.find((a) => a.status === "odpowiedz")!;
    const target = Math.round(agent.price! * 0.92);
    const draftId = await draftNegotiation(db, sandbox.id, q.id, agent.agentQuoteId, target, at(512));
    const [draft] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.id, draftId)));
    expect(draft.body.replace(/\s/g, "")).toContain(String(target));
    expect(draft.body).not.toMatch(/Sudety/);
    await sendAgentDraft(db, sandbox.id, draftId, { subject: draft.subject!, body: draft.body }, at(512));
    await runTick(db, sandbox.id, realAt(620));
    const [aq] = await db.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandbox.id), eq(agentQuotes.id, agent.agentQuoteId)));
    expect(aq.price).toBeLessThan(agent.price!);
    expect(aq.price).toBeGreaterThanOrEqual(target);
  });

  it("asks for missing data and continues once the salesperson completes it", async () => {
    const q = await inquiry("ct-hanza-1", "Zapytanie o stawkę: transport lotniczy próbek", "Ile kosztowałby transport lotniczy 2 palet próbek (180 kg) z Poznania do Toronto? Termin elastyczny.", 621);
    expect(q).toMatchObject({ mode: "air", status: "niekompletne" });
    expect(q.missingFields).toEqual(["incoterms", "wymiary lub objętość (CBM)"]);
    let view = await quoteDetail(db, sandbox.id, q.id);
    expect(view.clientThread.some((m) => m.state === "draft" && m.body.includes("incoterms"))).toBe(true);
    expect(view.agents).toHaveLength(0);
    await updateDetails(db, sandbox.id, q.id, { incoterms: "EXW", volumeCbm: 1.6 }, at(625));
    view = await quoteDetail(db, sandbox.id, q.id);
    expect(view.status).toBe("zbieranie");
    expect(view.agents.map((a) => a.agentId).sort()).toEqual(["ag-aerocargo", "ag-multi", "ag-skyline"]);
    expect(view.agents[0].thread[0].body).toContain("Waga płatna: 267 kg");
  });

  it("prices a road inquiry from own rates with an estimated distance", async () => {
    const q = await inquiry("ct-meble-1", "Prośba o wycenę transportu", "Dzień dobry, prosimy o wycenę: 10 palet, 4 t, Poznań – Lyon, termin 20.10.", 630);
    expect(q).toMatchObject({ mode: "road", status: "gotowe" });
    const view = await quoteDetail(db, sandbox.id, q.id);
    const calc = view.calculation!;
    expect(calc).toMatchObject({ vehicleKind: "solo", currency: "EUR", kmSource: "szacunek" });
    expect(calc.loadedKm).toBeGreaterThan(1350);
    expect(calc.loadedKm).toBeLessThan(1500);
    expect(calc.price).toBe(Math.ceil(Math.round(calc.cost * 1.12 * 100) / 100));
    const updated = await recalcRoad(db, sandbox.id, q.id, { kmOverride: 1250, marginPct: 15 });
    expect(updated).toMatchObject({ loadedKm: 1250, marginPct: 15 });
    const draftId = await draftOffer(db, sandbox.id, q.id, at(631));
    const [draft] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.id, draftId)));
    expect(draft.body.replace(/\s/g, "")).toContain(String(updated.price));
  });

  it("waits for approval when automatic sending is off", async () => {
    await db.update(salesSettings).set({ autoSend: false }).where(eq(salesSettings.sandboxId, sandbox.id));
    const q = await inquiry("ct-wisla-2", "Wycena kolejowa", "Prosimy o ofertę: 2 x 20' koleją z Chengdu do Łodzi, CPT Łódź, 18 t, części maszyn, gotowe 30.10.", 640);
    expect(q.status).toBe("do_zatwierdzenia");
    await approveSending(db, sandbox.id, q.id, at(641));
    const view = await quoteDetail(db, sandbox.id, q.id);
    expect(view.status).toBe("zbieranie");
    expect(view.agents.map((a) => a.agentId).sort()).toEqual(["ag-eurasia", "ag-gdansk-cargo", "ag-multi", "ag-silk-rail"]);
  });
});
