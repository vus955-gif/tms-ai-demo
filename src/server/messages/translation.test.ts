import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, ParseRequest, ParseResponse } from "@/ai/client";
import { setAiClientForTests } from "@/ai/client";
import { classifyByRules } from "@/ai/fallback/driver-message-rules";
import { translateForDriver } from "@/ai/functions/translate-for-driver";
import { drivers, messages, orders } from "@/db/schema";
import type { Db } from "@/db/types";
import { cancellationSms, cmrMissingSms, orderSms, reminderSms } from "@/domain/sms-templates";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { driverOrderView } from "../driver-link/links";
import { assignOrder } from "../orders/assign";
import { approveDraftOrder } from "../orders/drafts";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { sendToDriver, storeDriverInbound } from "./gateway";
import { processDriverInbound } from "./inbound";
import { threadDetail } from "./threads";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

/** Answers classification and translation requests the way a good model would. */
const ai = (answers: { classification?: Record<string, unknown>; translation?: string }): AiClient => ({
  async parse<T>(request: ParseRequest<T>): Promise<ParseResponse<T>> {
    const translating = request.system.startsWith("Tłumaczysz");
    return { parsed: (translating ? { translation: answers.translation } : answers.classification) as T, stopReason: "end_turn", inputTokens: 300, outputTokens: 90 };
  },
  async capabilities() {
    return { imageInput: true, structuredOutputs: true };
  },
});

const order = {
  number: "ZL-1043",
  pickupFrom: new Date("2026-10-15T05:00:00Z"),
  pickupTo: new Date("2026-10-15T07:00:00Z"),
  deliveryFrom: new Date("2026-10-15T11:00:00Z"),
  deliveryTo: new Date("2026-10-15T13:00:00Z"),
  cargoPallets: 12,
  cargoKg: 4800,
  bodyRequired: "chlodnia",
  adrRequired: true,
  references: ["LW-5501"],
  notes: "Dzwonić 30 min przed przyjazdem",
};
const point = (name: string, city: string, country: string, notes = "") => ({ name, address: "ul. Magazynowa 3", city, country, requirements: "", notes });

describe("B1: translator for drivers (Ukrainian and Russian)", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const thread = (driverId: string) => db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.driverId, driverId))).orderBy(asc(messages.atSim));
  const say = async (driverId: string, body: string, minute: number) => {
    const simNow = (await runTick(db, sandbox.id, realAt(minute))).simNow;
    const id = await storeDriverInbound(db, sandbox.id, { driverId, body, atSim: simNow });
    await processDriverInbound(db, sandbox.id, id, { simNow });
    return (await thread(driverId)).find((m) => m.id === id)!;
  };

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "translation", realNow: realStart });
  });
  afterEach(() => setAiClientForTests(null));

  it("system SMS use ready-made translations: fixed words change, order data does not", () => {
    const uk = orderSms(order, "Logistyka Wisła Sp. z o.o.", point("Magazyn Gądki", "Gądki", "PL", "Wjazd bramą nr 2"), point("Hub Leipzig", "Leipzig", "DE"), "https://tms.example/k/abc", "uk");
    expect(uk.split("\n")).toEqual([
      "ЗАМОВЛЕННЯ ZL-1043 · Logistyka Wisła Sp. z o.o.",
      "ЗАВАНТАЖЕННЯ: 15.10 07:00–09:00",
      "Magazyn Gądki, ul. Magazynowa 3, Gądki (PL)",
      "Примітки (польською): Wjazd bramą nr 2",
      "РОЗВАНТАЖЕННЯ: 15.10 13:00–15:00",
      "Hub Leipzig, ul. Magazynowa 3, Leipzig (DE)",
      "Вантаж: 12 палет, 4800 кг, рефрижератор, ADR",
      "Ref: LW-5501",
      "Примітки до замовлення (польською): Dzwonić 30 min przed przyjazdem",
      "Деталі та підтвердження одним натисканням: https://tms.example/k/abc",
      "Підтвердіть, відповівши OK.",
    ]);
    const ru = orderSms(order, "Logistyka Wisła Sp. z o.o.", point("Magazyn Gądki", "Gądki", "PL"), point("Hub Leipzig", "Leipzig", "DE"), undefined, "ru");
    expect(ru).toContain("ЗАКАЗ ZL-1043");
    expect(ru).toContain("ВЫГРУЗКА: 15.10 13:00–15:00");
    expect(ru.endsWith("Подтвердите, ответив OK.")).toBe(true);
    expect(reminderSms(order, "uk")).toBe("Нагадування: підтвердіть замовлення ZL-1043 (завантаження 15.10 07:00). Відповідайте OK або зателефонуйте диспетчеру.");
    expect(cancellationSms(order, "ru")).toBe("Заказ ZL-1043 отменён. Не выезжайте на загрузку. Если есть вопросы, позвоните диспетчеру.");
    expect(cmrMissingSms(order, "uk")).toContain("ZL-1043");
    // Polish is unchanged, weekday and all.
    expect(orderSms(order, "X", point("A", "Gądki", "PL"), point("B", "Leipzig", "DE"))).toContain("ZAŁADUNEK: cz 15.10 07:00–09:00");
  });

  it("rules read the plainest Ukrainian and Russian answers and leave the rest to a person", () => {
    const c = (text: string) => classifyByRules(text).category;
    expect(["ок", "Добре, їду", "Підтверджую", "Хорошо, еду", "да, ок", "Принимаю"].map(c)).toEqual(Array(6).fill("potwierdzenie"));
    expect(["Не можу, завтра маю вихідний", "Не поеду, машина идёт в сервис"].map(c)).toEqual(["odmowa", "odmowa"]);
    expect(c("Який номер рампи?")).toBe("warunek_pytanie");
    expect(c("Добре, але буду приблизно на 2 години пізніше")).toBe("warunek_pytanie");
    expect(c("Стою в заторі біля Познані")).toBe("niejasne");
    expect(classifyByRules("Добре, їду").polish).toBeNull();
  });

  it("a Ukrainian-speaking driver gets the order SMS and the order page in Ukrainian; the dispatcher keeps the Polish text", async () => {
    const at = (await runTick(db, sandbox.id, realAt(52))).simNow;
    await approveDraftOrder(db, sandbox.id, "zl-1043", null, at);
    await assignOrder(db, sandbox.id, "zl-1043", "d-petrenko", { actor: "dispatcher", simNow: at, replyAfterMin: 600 });
    const sms = (await thread("d-petrenko")).find((m) => m.kind === "order")!;
    expect(sms.body).toContain("ЗАМОВЛЕННЯ ZL-1043");
    expect(sms.body).toContain("Підтвердіть, відповівши OK.");
    expect(sms.translation).toContain("ZLECENIE ZL-1043");
    expect(sms.translation?.endsWith("Potwierdź odpisując OK.")).toBe(true);
    const token = /\/k\/([A-Za-z0-9_-]{16})/.exec(sms.body)![1];
    const page = await driverOrderView(db, token, realAt(52));
    expect(page.language).toBe("uk");
    expect(page.pickup.window).toMatch(/^\d{1,2}\.\d{2} \d{2}:\d{2}–\d{2}:\d{2}$/);
    const view = await threadDetail(db, sandbox.id, "d-petrenko");
    expect(view.language).toBe("uk");
    expect(view.messages.find((m) => m.kind === "order")?.translation).toContain("ZLECENIE");
    // A Polish-speaking driver's SMS carries no translation.
    expect((await thread("d-grabowski")).find((m) => m.kind === "order")?.translation).toBeNull();
  });

  it("her Ukrainian confirmation is understood without AI and confirms the order", async () => {
    const m = await say("d-petrenko", "Добре, їду", 53);
    expect(m).toMatchObject({ aiCategory: "potwierdzenie", classifiedBy: "rules", translation: null });
    const [o] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, "zl-1043")));
    expect(o.status).toBe("POTWIERDZONE");
  });

  it("with AI an inbound message is stored with its Polish translation", async () => {
    setAiClientForTests(
      ai({ classification: { category: "operacyjne", subtype: "opoznienie", summary: "Kierowca stoi w korku pod Poznaniem.", priority: "wysoki", confidence: 0.9, suggested_replies: ["Przyjąłem, informuję klienta."], site_note: null, site_stop: null, polish: "Stoję w korku pod Poznaniem, będę godzinę później." } }),
    );
    const m = await say("d-petrenko", "Стою в заторі біля Познані, буду на годину пізніше.", 54);
    expect(m).toMatchObject({ aiCategory: "operacyjne", classifiedBy: "ai", translation: "Stoję w korku pod Poznaniem, będę godzinę później." });
    expect(m.aiSummary).toBe("Kierowca stoi w korku pod Poznaniem.");
  });

  it("translates the dispatcher's reply only when nothing factual got lost", async () => {
    const simNow = (await runTick(db, sandbox.id, realAt(55))).simNow;
    const text = "Rozładunek ZL-1043 przesunięty na 14:30, rampa 12.";
    setAiClientForTests(ai({ translation: "Розвантаження ZL-1043 перенесено на 14:30, рампа 12." }));
    expect(await translateForDriver({ db, sandboxId: sandbox.id, simNow, text, language: "uk" })).toBe("Розвантаження ZL-1043 перенесено на 14:30, рампа 12.");
    // The hour changed in translation: not sent.
    setAiClientForTests(ai({ translation: "Розвантаження ZL-1043 перенесено на 15:30, рампа 12." }));
    expect(await translateForDriver({ db, sandboxId: sandbox.id, simNow, text, language: "uk" })).toBeNull();
    // Without AI there is no translation at all.
    setAiClientForTests(null);
    expect(await translateForDriver({ db, sandboxId: sandbox.id, simNow, text, language: "ru" })).toBeNull();
  });

  it("switching a driver back to Polish switches the system SMS back", async () => {
    const simNow = (await runTick(db, sandbox.id, realAt(56))).simNow;
    await db.update(drivers).set({ language: "pl" }).where(and(eq(drivers.sandboxId, sandbox.id), eq(drivers.id, "d-kozlow")));
    await sendToDriver(db, sandbox.id, { driverId: "d-kozlow", localized: (lang) => cancellationSms({ number: "ZL-1041" }, lang), kind: "cancellation", sentBy: "system", atSim: simNow });
    const last = (await thread("d-kozlow")).at(-1)!;
    expect(last.body.startsWith("Zlecenie ZL-1041 zostało odwołane.")).toBe(true);
    expect(last.translation).toBeNull();
  });
});
