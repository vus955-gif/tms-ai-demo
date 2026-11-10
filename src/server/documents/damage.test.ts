import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, ParseResponse } from "@/ai/client";
import { setAiClientForTests } from "@/ai/client";
import { aiLog, documents, messages } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { listDocuments } from "./cmr";
import { prepareDamageCase, setDamageStep } from "./damage";

const realStart = new Date("2026-10-14T06:00:00Z");
const REMARK = "2 palety uszkodzone, folia rozerwana — przyjęto z zastrzeżeniem";

const aiSaying = (assessment: Record<string, unknown>): AiClient => ({
  async parse<T>(): Promise<ParseResponse<T>> {
    return { parsed: assessment as T, stopReason: "end_turn", inputTokens: 600, outputTokens: 260 };
  },
  async capabilities() {
    return { imageInput: true, structuredOutputs: true };
  },
});

describe("B4: damage assistant from the consignee's remark on a CMR", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const simNow = new Date("2026-10-14T12:00:00Z");

  /** A CMR as the document flow leaves it: read by AI, matched to an order, with or without a remark. */
  const cmr = async (orderId: string | null, remarks: string | null) => {
    const id = randomUUID();
    await db.insert(documents).values({
      sandboxId: sandbox.id,
      id,
      driverId: "d-kaminska",
      kind: "cmr",
      status: orderId ? "do_zamkniecia" : "do_weryfikacji",
      readBy: "ai",
      quality: { legible: true, stamp: true, signature: true, remarks },
      matchedOrderId: orderId,
      createdSim: simNow,
    });
    return id;
  };
  const drafts = () => db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.kind, "draft_damage")));

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "damage", realNow: realStart });
  });
  afterEach(() => setAiClientForTests(null));

  it("without AI: rules name the kind, the checklist quotes CMR deadlines, a template draft waits in the inbox", async () => {
    // ZL-1035 runs Gądki → Leipzig: international, so the CMR Convention applies.
    const docId = await cmr("zl-1035", REMARK);
    const c = await prepareDamageCase(db, sandbox.id, docId, simNow);
    expect(c).toMatchObject({ kind: "uszkodzenie", kindLabel: "uszkodzenie ładunku", source: "rules", mailFrom: "szablon", affected: null });
    expect(c.steps.map((s) => s.done)).toEqual([false, false, false, false, false]);
    expect(c.notes.join(" ")).toContain("art. 30 CMR");

    const [draft] = await drafts();
    expect(draft).toMatchObject({ state: "draft", direction: "out", party: "client", orderId: "zl-1035", classifiedBy: "rules" });
    expect(draft.subject).toBe("Zlecenie ZL-1035: zastrzeżenie odbiorcy przy dostawie");
    expect(draft.body).toContain(`„${REMARK}”`);
    expect(draft.threadKey).toContain(draft.id);
    expect(c.mail).toEqual({ rootId: draft.id, state: "draft" });

    // Asking again returns the same case: one document, one case, one draft.
    expect((await prepareDamageCase(db, sandbox.id, docId, simNow)).id).toBe(c.id);
    expect(await drafts()).toHaveLength(1);
    const listed = (await listDocuments(db, sandbox.id)).find((d) => d.id === docId)!;
    expect(listed.damage?.id).toBe(c.id);
  });

  it("ticks checklist steps on and off", async () => {
    const [doc] = (await listDocuments(db, sandbox.id)).filter((d) => d.damage);
    const after = await setDamageStep(db, sandbox.id, doc.id, "ubezpieczyciel", true);
    expect(after.steps.find((s) => s.id === "ubezpieczyciel")?.done).toBe(true);
    expect((await setDamageStep(db, sandbox.id, doc.id, "ubezpieczyciel", false)).steps.every((s) => !s.done)).toBe(true);
    await expect(setDamageStep(db, sandbox.id, doc.id, "nie-ma", true)).rejects.toMatchObject({ status: 400 });
  });

  it("with AI: keeps the model's classification and its e-mail when the e-mail states facts only", async () => {
    setAiClientForTests(
      aiSaying({
        kind: "brak",
        affected: "3 kartony",
        summary: "Odbiorca zgłosił brak 3 kartonów względem dokumentu WZ.",
        mail_subject: "ZL-1033: zastrzeżenie odbiorcy na CMR",
        mail_body: "Dzień dobry,\n\nprzy dostawie zlecenia ZL-1033 odbiorca wpisał na CMR: „Brak 3 kartonów”. Wyjaśniamy okoliczności i prosimy o protokół oraz zdjęcia.\n\nPozdrawiam\nDział spedycji\nTransDemo Sp. z o.o.",
      }),
    );
    const c = await prepareDamageCase(db, sandbox.id, await cmr("zl-1033", "Brak 3 kartonów"), simNow);
    expect(c).toMatchObject({ kind: "brak", affected: "3 kartony", source: "ai", mailFrom: "ai" });
    const draft = (await drafts()).find((d) => d.orderId === "zl-1033")!;
    expect(draft.subject).toBe("ZL-1033: zastrzeżenie odbiorcy na CMR");
    expect(draft.classifiedBy).toBe("ai");
    const [log] = await db.select().from(aiLog).where(and(eq(aiLog.sandboxId, sandbox.id), eq(aiLog.fn, "assessDamage"), eq(aiLog.fallbackUsed, false)));
    expect(log.inputRef).toContain("ZL-1033");
  });

  it("with AI: an e-mail that accepts liability is replaced by the template, the classification stays", async () => {
    setAiClientForTests(
      aiSaying({
        kind: "uszkodzenie",
        affected: "1 paleta",
        summary: "Odbiorca zgłosił uszkodzenie jednej palety.",
        mail_subject: "ZL-1037: szkoda",
        mail_body: "Dzień dobry,\n\nprzepraszamy, przyjmujemy odpowiedzialność za szkodę przy ZL-1037 i pokryjemy koszty.\n\nPozdrawiam",
      }),
    );
    const c = await prepareDamageCase(db, sandbox.id, await cmr("zl-1037", "1 paleta zgnieciona"), simNow);
    expect(c).toMatchObject({ kind: "uszkodzenie", affected: "1 paleta", source: "ai", mailFrom: "szablon" });
    const draft = (await drafts()).find((d) => d.orderId === "zl-1037")!;
    expect(draft.body).not.toContain("przyjmujemy odpowiedzialność");
    expect(draft.body).toContain("„1 paleta zgnieciona”");
  });

  it("domestic carriage: the checklist does not quote the CMR Convention", async () => {
    // ZL-1038 runs Szczecin → Poznań.
    const c = await prepareDamageCase(db, sandbox.id, await cmr("zl-1038", "Karton zamoczony"), simNow);
    expect(c.notes.join(" ")).toContain("Prawo przewozowe");
    expect(c.notes.join(" ")).not.toContain("art. 30");
  });

  it("needs a remark and a matched order", async () => {
    await expect(prepareDamageCase(db, sandbox.id, await cmr("zl-1036", null), simNow)).rejects.toThrow("nie ma adnotacji");
    await expect(prepareDamageCase(db, sandbox.id, await cmr(null, "Brak palety"), simNow)).rejects.toThrow("Najpierw przypisz");
    await expect(prepareDamageCase(db, sandbox.id, "nie-ma", simNow)).rejects.toMatchObject({ status: 404 });
  });
});
