import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, ParseResponse } from "@/ai/client";
import { setAiClientForTests } from "@/ai/client";
import { classifyByRules } from "@/ai/fallback/driver-message-rules";
import { pointNoteSuggestions, points } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { storeDriverInbound } from "../messages/gateway";
import { processDriverInbound } from "../messages/inbound";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { buildSnapshot } from "../snapshot";
import { runTick } from "../tick/engine";
import { clientsOverview } from "./clients";
import { decidePointSuggestion, openPointSuggestionsCount } from "./point-notes";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

const aiSaying = (classification: Record<string, unknown>): AiClient => ({
  async parse<T>(): Promise<ParseResponse<T>> {
    return { parsed: classification as T, stopReason: "end_turn", inputTokens: 400, outputTokens: 80 };
  },
  async capabilities() {
    return { imageInput: true, structuredOutputs: true };
  },
});

describe("B3: what drivers write about places becomes proposed notes for the point", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const point = async (id: string) => (await db.select().from(points).where(and(eq(points.sandboxId, sandbox.id), eq(points.id, id))))[0];
  const berlin = async () => (await clientsOverview(db, sandbox.id)).find((c) => c.id === "cl-meble")!.points.find((p) => p.id === "pt-meble-berlin")!;
  const say = async (driverId: string, body: string, minute: number) => {
    const simNow = (await runTick(db, sandbox.id, realAt(minute))).simNow;
    const messageId = await storeDriverInbound(db, sandbox.id, { driverId, body, atSim: simNow });
    return processDriverInbound(db, sandbox.id, messageId, { simNow });
  };

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "point-notes", realNow: realStart });
  });
  afterEach(() => setAiClientForTests(null));

  it("rules pick out messages about the place itself, not confirmations, questions or today's trouble", () => {
    const note = (text: string) => classifyByRules(text).site_note;
    expect(note("Rozładunek jest od tyłu hali, rampa 4, wjazd od Industriestrasse.")).toContain("rampa 4");
    expect(note("ok, podjadę pod rampę jak tylko dojadę na miejsce")).toBeNull();
    expect(note("Która brama jest dla ciężarówek, bo są tu dwie?")).toBeNull();
    expect(note("korek na A2, będę ok. 40 min później")).toBeNull();
    expect(note("brama")).toBeNull();
  });

  it("the scripted message from the driver heading to Berlin becomes a proposal for the Berlin point", async () => {
    await runTick(db, sandbox.id, realAt(80));
    const p = await berlin();
    expect(p.suggestions).toHaveLength(1);
    expect(p.suggestions[0]).toMatchObject({ source: "rules", driverName: "Jan Nowak" });
    expect(p.suggestions[0].text).toContain("rampa 4");
    expect(await openPointSuggestionsCount(db, sandbox.id)).toBe(1);
    const tick = await runTick(db, sandbox.id, realAt(81));
    expect((await buildSnapshot(db, sandbox, tick.simNow, realAt(81))).badges.klienci).toBe(1);
    // Nothing reaches other drivers before the dispatcher decides.
    expect((await point("pt-meble-berlin")).notes).not.toContain("rampa 4");
  });

  it("accepting adds the (reworded) note to the point; it cannot be decided twice", async () => {
    const before = (await point("pt-meble-berlin")).notes;
    const [s] = (await berlin()).suggestions;
    const simNow = (await runTick(db, sandbox.id, realAt(82))).simNow;
    await decidePointSuggestion(db, sandbox.id, "pt-meble-berlin", { suggestionId: s.id, action: "accept", text: "  Rozładunek od tyłu hali, rampa 4;   wjazd od Industriestrasse " }, simNow);
    expect((await point("pt-meble-berlin")).notes).toBe([before, "Rozładunek od tyłu hali, rampa 4; wjazd od Industriestrasse."].filter(Boolean).join(" "));
    expect((await berlin()).suggestions).toHaveLength(0);
    await expect(decidePointSuggestion(db, sandbox.id, "pt-meble-berlin", { suggestionId: s.id, action: "reject" }, simNow)).rejects.toThrow("już rozpatrzona");
    // A proposal belongs to its point: it cannot be accepted onto another one.
    await expect(decidePointSuggestion(db, sandbox.id, "pt-odra-dresden", { suggestionId: s.id, action: "accept" }, simNow)).rejects.toMatchObject({ status: 404 });
  });

  it("with AI the note is the model's one sentence and the stop it named; rejecting leaves the point alone", async () => {
    // d-zielinski is on the way to Dresden (ZL-1033) but writes about the loading place in Brzeg Dolny.
    setAiClientForTests(
      aiSaying({ category: "luzne", subtype: null, summary: "Uwaga o miejscu załadunku.", priority: "niski", confidence: 0.9, suggested_replies: ["Dzięki za info."], site_note: "Załadunek ADR tylko po okazaniu zaświadczenia na portierni.", site_stop: "zaladunek" }),
    );
    const c = await say("d-zielinski", "Tak na przyszłość: w Brzegu przed wjazdem na załadunek ADR trzeba pokazać papiery na portierni, bez tego nie wpuszczą.", 83);
    expect(c.site_note).toBe("Załadunek ADR tylko po okazaniu zaświadczenia na portierni.");
    const brzeg = (await clientsOverview(db, sandbox.id)).find((x) => x.id === "cl-odra")!.points.find((p) => p.id === "pt-odra-brzeg")!;
    expect(brzeg.suggestions).toHaveLength(1);
    expect(brzeg.suggestions[0]).toMatchObject({ source: "ai", text: "Załadunek ADR tylko po okazaniu zaświadczenia na portierni." });
    expect(brzeg.suggestions[0].quote).toContain("Tak na przyszłość");

    const notes = (await point("pt-odra-brzeg")).notes;
    await decidePointSuggestion(db, sandbox.id, "pt-odra-brzeg", { suggestionId: brzeg.suggestions[0].id, action: "reject" }, (await runTick(db, sandbox.id, realAt(84))).simNow);
    expect((await point("pt-odra-brzeg")).notes).toBe(notes);
    expect(await db.select().from(pointNoteSuggestions).where(and(eq(pointNoteSuggestions.sandboxId, sandbox.id), eq(pointNoteSuggestions.status, "odrzucona")))).toHaveLength(1);
  });

  it("ignores remarks from a driver without an order: there is no place to attach them to", async () => {
    const before = await openPointSuggestionsCount(db, sandbox.id);
    // d-dabrowski rests at the base with no order.
    await say("d-dabrowski", "Na bazie w Łodzi brama od strony parkingu się zacina, trzeba dzwonić na portiernię.", 85);
    expect(await openPointSuggestionsCount(db, sandbox.id)).toBe(before);
  });
});
