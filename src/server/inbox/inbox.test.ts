import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests, type AiClient, type ParseResponse } from "@/ai/client";
import { alerts, messages, orders } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { approveDraftOrder, rejectDraftOrder } from "../orders/drafts";
import { composeDelayNotice, discardDraft, requestReplyDraft, sendDraft } from "./actions";
import { storeClientInbound, unreadClientEmails } from "./gateway";
import { prepareReplyDraft, processClientEmail } from "./process";
import { inboxThread, listInbox } from "./views";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

/** An AI that ignores the rules and names the driver — the safety net must catch it. */
const leakyAi: AiClient = {
  async parse<T>(): Promise<ParseResponse<T>> {
    const parsed = { subject: "Status", body: "Kierowca Paweł Szymański (tel. +48 999 100 107) będzie o 14:00." };
    return { parsed: parsed as T, stopReason: "end_turn", inputTokens: 900, outputTokens: 80 };
  },
  async capabilities() {
    return { imageInput: true, structuredOutputs: true };
  },
};

describe("stage 3b: client inbox", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const order = async (id: string) => (await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id))))[0];
  const clientMail = () => db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.party, "client")));

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "inbox", realNow: realStart });
  });
  afterEach(() => setAiClientForTests(null));

  it("turns the T+40 order e-mail into draft ZL-1043 with points from the client's book", async () => {
    await runTick(db, sandbox.id, realAt(45));
    const draft = await order("zl-1043");
    expect(draft).toMatchObject({ status: "SZKIC", source: "email", clientId: "cl-wisla", pickupPointId: "pt-wisla-gadki", deliveryPointId: "pt-wisla-lipsk", cargoPallets: 12, cargoKg: 4800 });
    expect(draft.references).toEqual(["LW-5501"]);
    expect(draft.pickupFrom.toISOString()).toBe(atMin(sandbox.simOrigin, 22 * 60 + 30).toISOString());
    expect(draft.deliveryTo.toISOString()).toBe(atMin(sandbox.simOrigin, 30 * 60 + 30).toISOString());
    const [mail] = await clientMail();
    expect(mail).toMatchObject({ aiCategory: "zamowienie_transportu", classifiedBy: "rules", orderId: "zl-1043" });
    expect(draft.sourceMessageId).toBe(mail.id);
    expect(await unreadClientEmails(db, sandbox.id)).toBe(1);
    const items = await listInbox(db, sandbox.id);
    expect(items[0]).toMatchObject({ subject: expect.stringContaining("Gądki"), orderNumber: "ZL-1043", orderStatus: "SZKIC", unread: true });
  });

  it("approves the draft with the dispatcher's corrections", async () => {
    const at = atMin(sandbox.simOrigin, 46);
    const thread = await inboxThread(db, sandbox.id, (await clientMail())[0].id);
    await expect(approveDraftOrder(db, sandbox.id, "zl-1043", { ...thread.order!.values, clientId: "cl-baltic" }, at)).rejects.toThrow(/klienta/);
    await approveDraftOrder(db, sandbox.id, "zl-1043", { ...thread.order!.values, cargoPallets: 14 }, at);
    expect(await order("zl-1043")).toMatchObject({ status: "NOWE", cargoPallets: 14 });
    await expect(rejectDraftOrder(db, sandbox.id, "zl-1043", at)).rejects.toThrow(/szkicem/);
  });

  it("drafts a status reply from clientView only (T+120, ZL-1037)", async () => {
    await runTick(db, sandbox.id, realAt(125));
    const mail = (await clientMail()).find((m) => m.subject?.startsWith("Gdzie jest auto"))!;
    expect(mail).toMatchObject({ aiCategory: "zapytanie_o_status", orderId: "zl-1037" });
    const thread = await inboxThread(db, sandbox.id, mail.id);
    const draft = thread.messages.find((m) => m.state === "draft")!;
    expect(draft.body).toContain("ZL-1037");
    expect(draft.body).toContain("WB 6P77");
    expect(draft.body).toMatch(/w drodze do odbiorcy/);
    expect(draft.body).not.toMatch(/Szymański|Paweł|999 100/);
    expect(thread.clientView).toMatchObject({ number: "ZL-1037", plates: "WB 6P77" });
  });

  it("covers every truck on the road when the client gives no order number", async () => {
    const at = atMin(sandbox.simOrigin, 125);
    const id = await storeClientInbound(db, sandbox.id, { contactId: "ct-mazovia-1", subject: "Gdzie jest nasze auto?", body: "Dzień dobry, gdzie jest teraz auto i o której będzie?", atSim: at });
    await processClientEmail(db, sandbox.id, id, { simNow: at });
    const thread = await inboxThread(db, sandbox.id, id);
    const draft = thread.messages.find((m) => m.state === "draft")!;
    expect(draft.body).toContain("ZL-1037");
    expect(draft.body).toContain("ZL-1039");
    expect(draft.body).toMatch(/W drodze są 2/);
    await discardDraft(db, sandbox.id, draft.id);
  });

  it("replaces an AI draft that names the driver with the template", async () => {
    setAiClientForTests(leakyAi);
    const mail = (await clientMail()).find((m) => m.orderId === "zl-1037")!;
    const id = await prepareReplyDraft(db, sandbox.id, {
      goal: "status_dla_klienta",
      threadKey: mail.threadKey,
      contactId: mail.clientContactId!,
      orderId: "zl-1037",
      email: { subject: mail.subject!, body: mail.body },
      simNow: atMin(sandbox.simOrigin, 126),
      kind: "draft_status",
    });
    const [saved] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.id, id)));
    expect(saved.body).not.toContain("Szymański");
    expect(saved.classifiedBy).toBe("rules");
    await discardDraft(db, sandbox.id, id);
  });

  it("sends a draft (stored only) and refuses to send it twice", async () => {
    const mail = (await clientMail()).find((m) => m.orderId === "zl-1037" && m.direction === "in")!;
    const draftId = await requestReplyDraft(db, sandbox.id, mail.id, atMin(sandbox.simOrigin, 127));
    await sendDraft(db, sandbox.id, draftId, { subject: "Re: status", body: "Auto WB 6P77 jest w drodze." }, atMin(sandbox.simOrigin, 128));
    const [sent] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.id, draftId)));
    expect(sent).toMatchObject({ state: "sent", sentBy: "dispatcher" });
    await expect(sendDraft(db, sandbox.id, draftId, { subject: "x", body: "y" }, new Date())).rejects.toThrow(/wysłana/);
  });

  it("handles the bot's order e-mail and quote requests", async () => {
    // T+80: Agro-Pol orders feed transport → another draft.
    const drafts = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.clientId, "cl-agropol"), eq(orders.status, "SZKIC")));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ pickupPointId: "pt-agropol-kutno", deliveryPointId: "pt-agropol-gdynia", cargoPallets: 20, cargoKg: 9600 });

    const at = atMin(sandbox.simOrigin, 130);
    const id = await storeClientInbound(db, sandbox.id, { contactId: "ct-sudety-1", subject: "Wycena kontenera", body: "Prosimy o ofertę na fracht morski FCL 40' Gdańsk – Szanghaj, FOB.", atSim: at });
    const t = await processClientEmail(db, sandbox.id, id, { simNow: at });
    expect(t.category).toBe("zapytanie_ofertowe");
    const thread = await inboxThread(db, sandbox.id, id);
    expect(thread.messages.some((m) => m.state === "draft")).toBe(false);
  });

  it("asks the client for missing data when an order e-mail is incomplete", async () => {
    const at = atMin(sandbox.simOrigin, 131);
    const id = await storeClientInbound(db, sandbox.id, { contactId: "ct-wisla-2", subject: "Zlecenie transportu", body: "Prosimy o transport z Gądek do Lipska, 10 palet.", atSim: at });
    const t = await processClientEmail(db, sandbox.id, id, { simNow: at });
    expect(t.category).toBe("zamowienie_transportu");
    const thread = await inboxThread(db, sandbox.id, id);
    expect(thread.order).toBeNull();
    expect(thread.triage?.extracted?.problems).toEqual(expect.arrayContaining(["okno załadunku", "waga"]));
    const draft = thread.messages.find((m) => m.state === "draft")!;
    expect(draft.body).toContain("okno załadunku");
  });

  it("gives complaints high priority and an alert (T+300)", async () => {
    await runTick(db, sandbox.id, realAt(305));
    const mail = (await clientMail()).find((m) => m.aiCategory === "reklamacja")!;
    expect(mail.aiPriority).toBe("wysoki");
    const [alert] = await db.select().from(alerts).where(and(eq(alerts.sandboxId, sandbox.id), eq(alerts.kind, "complaint")));
    expect(alert).toMatchObject({ messageId: mail.id, actions: ["otworz_mail"] });
  });

  it("drafts a delay notice for the order's client from an alert", async () => {
    const at = atMin(sandbox.simOrigin, 306);
    const rootId = await composeDelayNotice(db, sandbox.id, "zl-1037", at);
    expect(await composeDelayNotice(db, sandbox.id, "zl-1037", at)).toBe(rootId);
    const thread = await inboxThread(db, sandbox.id, rootId);
    expect(thread.contact.id).toBe("ct-mazovia-1");
    expect(thread.messages[0]).toMatchObject({ state: "draft", direction: "out" });
    expect(thread.messages[0].subject).toContain("możliwe opóźnienie");
  });
});
