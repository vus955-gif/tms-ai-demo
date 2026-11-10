import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, ParseResponse } from "@/ai/client";
import { setAiClientForTests } from "@/ai/client";
import type { Db } from "@/db/types";
import { handoverNoteByRules, handoverSections, knownOrderNumbers, type HandoverFacts } from "@/domain/handover";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { draftHandover, handoverFacts, handoverView, saveHandover } from "./handover";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

const aiWriting = (note: string): AiClient => ({
  async parse<T>(): Promise<ParseResponse<T>> {
    return { parsed: { note } as T, stopReason: "end_turn", inputTokens: 900, outputTokens: 200 };
  },
  async capabilities() {
    return { imageInput: true, structuredOutputs: true };
  },
});

const quiet: HandoverFacts = {
  at: "śr 14.10 · 16:00",
  alerts: [],
  atRisk: [],
  unconfirmed: [],
  unassigned: [],
  drafts: 0,
  documents: { toClose: 0, toVerify: 0, illegible: 0 },
  inbox: { unread: 0, replyDrafts: 0 },
  shipmentsDue: 0,
  fleet: { overdue: [], soon: 0 },
  absences: [],
  pointSuggestions: 0,
};

describe("B2: shift handover", () => {
  let db: Db;
  let sandbox: SandboxRow;
  let simNow: Date;

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "handover", realNow: realStart });
    // 09:25: ZL-1042 was sent to the van driver five minutes ago and is not confirmed yet.
    simNow = (await runTick(db, sandbox.id, realAt(55))).simNow;
  });
  afterEach(() => setAiClientForTests(null));

  it("orders the facts by urgency and words the counts in correct Polish", () => {
    const sections = handoverSections({
      ...quiet,
      alerts: [
        { severity: "warning", title: "ZL-1032: mały zapas", body: "Kierowca ma 20 min zapasu." },
        { severity: "critical", title: "Awaria: WX 9T04", body: "Pojazd stoi na poboczu." },
      ],
      atRisk: [
        { number: "ZL-1034", route: "Łódź → Gdynia", driver: "Tomasz Wójcik", risk: "red", eta: "śr 14.10 · 15:10", deadline: "śr 14.10 · 14:30" },
        // Already described by the warning alert above: not listed a second time.
        { number: "ZL-1032", route: "Pruszcz Gdański → Janki", driver: "Anna Wiśniewska", risk: "yellow", eta: null, deadline: "śr 14.10 · 17:30" },
      ],
      drafts: 2,
      documents: { toClose: 1, toVerify: 0, illegible: 3 },
      fleet: { overdue: ["EL 9K41: legalizacja tachografu (blokuje przydział)"], soon: 4 },
      absences: [{ driver: "Ewa Kamińska", label: "urlop", from: "15.10" }],
    });
    expect(sections.map((s) => s.title)).toEqual(["Pilne", "Do dopilnowania", "Kolejki", "Na horyzoncie"]);
    expect(sections[0].lines).toEqual([
      "Awaria: WX 9T04. Pojazd stoi na poboczu.",
      "ZL-1034 (Łódź → Gdynia, Tomasz Wójcik): zagrożony termin, prognoza śr 14.10 · 15:10, okno do śr 14.10 · 14:30.",
      "Po terminie: EL 9K41: legalizacja tachografu (blokuje przydział).",
    ]);
    expect(sections[1].lines).toEqual(["ZL-1032: mały zapas. Kierowca ma 20 min zapasu."]);
    expect(sections[2].lines).toEqual(["2 szkice zleceń czekają na zatwierdzenie.", "CMR do zamknięcia zlecenia: 1.", "Nieczytelne CMR, kierowca poproszony o nowe zdjęcie: 3."]);
    expect(sections[3].lines).toEqual(["Ewa Kamińska: urlop od 15.10.", "Terminy floty w ciągu 30 dni lub 5 000 km: 4."]);
    expect(handoverSections(quiet)).toEqual([]);
    expect(handoverNoteByRules(quiet)).toContain("Spokojnie");
    expect([...knownOrderNumbers({ ...quiet, unconfirmed: [{ number: "ZL-1042", driver: "Jakub Grabowski", pickup: "śr 14.10 10:30–11:30" }] })]).toEqual(["ZL-1042"]);
  });

  it("reads the state of the demo world: unconfirmed order, overdue fleet terms, tomorrow's absences", async () => {
    const f = await handoverFacts(db, sandbox, simNow);
    expect(f.unconfirmed).toEqual([expect.objectContaining({ number: "ZL-1042", driver: "Jakub Grabowski" })]);
    expect(f.fleet.overdue).toEqual(expect.arrayContaining(["EL 9K41: legalizacja tachografu (blokuje przydział)", "EL 5R30: serwis okresowy"]));
    expect(f.absences.map((a) => a.driver)).toContain("Ewa Kamińska");
    expect(f.drafts).toBeGreaterThanOrEqual(1);
    // Info alerts are noise for a handover; only what needs attention is listed.
    expect(f.alerts.every((a) => a.severity !== "info")).toBe(true);
  });

  it("without AI drafts the note from the plain sections", async () => {
    const d = await draftHandover(db, sandbox, simNow);
    expect(d.source).toBe("fallback");
    expect(d.note).toContain("Przekazanie zmiany,");
    expect(d.note).toMatch(/Pilne:\n(- .*\n)*- Po terminie: EL 9K41: legalizacja tachografu \(blokuje przydział\)\./);
    // ZL-1031 is late because of the accident on the A2: the alert says so once, the order is not repeated.
    expect(d.note.match(/ZL-1031/g)).toHaveLength(1);
    expect(d.note).toContain("ZL-1042: Jakub Grabowski nie potwierdził jeszcze zlecenia");
  });

  it("with AI keeps the model's note only when it names orders from the facts", async () => {
    setAiClientForTests(aiWriting("- EL 9K41 po terminie tachografu, nie przydzielać.\n- ZL-1042: Jakub Grabowski nie potwierdził, zadzwonić."));
    const good = await draftHandover(db, sandbox, simNow);
    expect(good).toMatchObject({ source: "ai" });
    expect(good.note).toContain("zadzwonić");

    setAiClientForTests(aiWriting("- ZL-9999 stoi na granicy, pilne."));
    const invented = await draftHandover(db, sandbox, simNow);
    expect(invented.source).toBe("fallback");
    expect(invented.note).not.toContain("ZL-9999");
  });

  it("saves the note as the dispatcher left it and shows it to the next shift, newest first", async () => {
    await expect(saveHandover(db, sandbox, { body: "  ok ", source: "reczna" }, simNow)).rejects.toThrow("za krótka");
    await saveHandover(db, sandbox, { body: "Pierwsza notatka: wszystko pod kontrolą.", source: "rules" }, simNow);
    const later = (await runTick(db, sandbox.id, realAt(60))).simNow;
    await saveHandover(db, sandbox, { body: "  Druga notatka: zadzwonić do Grabowskiego w sprawie ZL-1042.  ", source: "ai" }, later);
    const view = await handoverView(db, sandbox, later);
    expect(view.history.map((h) => h.body)).toEqual(["Druga notatka: zadzwonić do Grabowskiego w sprawie ZL-1042.", "Pierwsza notatka: wszystko pod kontrolą."]);
    expect(view.history[0].source).toBe("ai");
    expect(view.sections[0].title).toBe("Pilne");
  });
});
