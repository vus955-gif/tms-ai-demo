import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, ParseResponse } from "@/ai/client";
import { setAiClientForTests } from "@/ai/client";
import { quoteRequests } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { storeClientInbound } from "../inbox/gateway";
import { processClientEmail } from "../inbox/process";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { updateSettings } from "./actions";
import { explainQuoteRanking, setClientQuoteProfile } from "./ranking";
import { quoteDetail, salesSettingsView } from "./views";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);
const SEA = "Dzień dobry,\nprosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t, gotowe do wysyłki od 25.10.\nLeszek Michalak, Sudety Papier";

const aiWriting = (recommendation: string): AiClient => ({
  async parse<T>(): Promise<ParseResponse<T>> {
    return { parsed: { recommendation } as T, stopReason: "end_turn", inputTokens: 500, outputTokens: 120 };
  },
  async capabilities() {
    return { imageInput: true, structuredOutputs: true };
  },
});

describe("E: client quoting profile and ranking of agents' rates", () => {
  let db: Db;
  let sandbox: SandboxRow;
  let quoteId: string;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  const inquiry = async (subject: string, minute: number) => {
    const id = await storeClientInbound(db, sandbox.id, { contactId: "ct-sudety-1", subject, body: SEA, atSim: at(minute) });
    await processClientEmail(db, sandbox.id, id, { simNow: at(minute) });
    const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.sourceMessageId, id)));
    return q.id;
  };
  const priced = async () => (await quoteDetail(db, sandbox.id, quoteId)).agents.filter((a) => a.status === "odpowiedz" && a.price !== null);

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "ranking", realNow: realStart });
    await runTick(db, sandbox.id, realAt(5));
    quoteId = await inquiry("Wycena — kontener do Chin", 6);
    // The agents answer over the next hours; collection closes at the deadline.
    for (const minute of [200, 320, 500]) await runTick(db, sandbox.id, realAt(minute));
  });
  afterEach(() => setAiClientForTests(null));

  it("ranks every priced rate against the default, balanced profile", async () => {
    const view = await quoteDetail(db, sandbox.id, quoteId);
    const rates = await priced();
    expect(rates.length).toBeGreaterThan(1);
    expect(view.profile).toEqual({ priceWeight: 50, note: "", label: "cena i czas są równie ważne" });
    expect(view.ranking.map((r) => r.id).sort()).toEqual(rates.map((a) => a.agentQuoteId).sort());
    expect(view.ranking[0].fitPct).toBeGreaterThanOrEqual(view.ranking.at(-1)!.fitPct);
    expect(view.ranking.every((r) => r.fitPct > 0 && r.fitPct <= 100 && r.reasons.length > 0)).toBe(true);
    // An agent who did not quote is not ranked.
    expect(view.agents.filter((a) => a.price === null).every((a) => !view.ranking.some((r) => r.id === a.agentQuoteId))).toBe(true);
  });

  it("the profile moves the ranking: price-only puts the cheapest first, time-only the fastest", async () => {
    const rates = await priced();
    const cheapest = Math.min(...rates.map((a) => a.price!));
    const fastest = Math.min(...rates.map((a) => a.transitDays ?? Infinity));

    await setClientQuoteProfile(db, sandbox.id, quoteId, { priceWeight: 100, note: "  lubi tanio i dłużej " });
    let view = await quoteDetail(db, sandbox.id, quoteId);
    expect(view.profile).toEqual({ priceWeight: 100, note: "lubi tanio i dłużej", label: "liczy się głównie cena" });
    expect(rates.find((a) => a.agentQuoteId === view.ranking[0].id)!.price).toBe(cheapest);
    expect(view.ranking[0].reasons[0]).toBe("najtańsza");

    await setClientQuoteProfile(db, sandbox.id, quoteId, { priceWeight: 0, note: "wszystko na już" });
    view = await quoteDetail(db, sandbox.id, quoteId);
    expect(rates.find((a) => a.agentQuoteId === view.ranking[0].id)!.transitDays).toBe(fastest);
    expect(view.ranking[0].fitPct).toBe(100);
    await expect(setClientQuoteProfile(db, sandbox.id, "nie-ma", { priceWeight: 50, note: "" })).rejects.toMatchObject({ status: 404 });
  });

  it("explains the ranking without AI, and with AI only when the text leads with the top offer", async () => {
    await setClientQuoteProfile(db, sandbox.id, quoteId, { priceWeight: 85, note: "lubi tanio i dłużej" });
    const view = await quoteDetail(db, sandbox.id, quoteId);
    const company = (id: string) => view.agents.find((a) => a.agentQuoteId === id)!.company;
    const best = company(view.ranking[0].id);
    const second = company(view.ranking[1].id);

    const rules = await explainQuoteRanking(db, sandbox.id, quoteId, at(501));
    expect(rules.source).toBe("fallback");
    expect(rules.text).toContain(`jest oferta ${best}`);
    expect(rules.text).toContain(`Dopasowanie ${view.ranking[0].fitPct}%`);

    setAiClientForTests(aiWriting(`Dla klienta nastawionego na cenę najlepiej wypada ${best}. ${second} warto rozważyć, jeśli termin okaże się ważniejszy.`));
    const good = await explainQuoteRanking(db, sandbox.id, quoteId, at(502));
    expect(good).toMatchObject({ source: "ai" });

    // The model tries to recommend the runner-up first: the algorithm's order stands.
    setAiClientForTests(aiWriting(`Polecam ${second}, a dopiero potem ${best}.`));
    const reordered = await explainQuoteRanking(db, sandbox.id, quoteId, at(503));
    expect(reordered.source).toBe("fallback");
    expect(reordered.text).toContain(`jest oferta ${best}`);
  });

  it("the profile belongs to the client: the next inquiry starts with it, and the agent limit applies", async () => {
    await updateSettings(db, sandbox.id, { maxAgentsPerRfq: 3 });
    expect((await salesSettingsView(db, sandbox.id)).maxAgentsPerRfq).toBe(3);
    const next = await quoteDetail(db, sandbox.id, await inquiry("Kolejna wycena — kontener do Chin", 510));
    expect(next.profile).toMatchObject({ priceWeight: 85, note: "lubi tanio i dłużej" });
    // Four sea agents cover Asia; with the limit at three, three are asked — each separately.
    expect(next.agents).toHaveLength(3);
    expect(next.ranking).toEqual([]);
    await expect(explainQuoteRanking(db, sandbox.id, next.id, at(511))).rejects.toThrow("nie ma czego porównywać");
  });
});
