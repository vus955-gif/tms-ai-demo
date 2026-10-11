import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agentQuotes, agents, clientContacts, messages, quoteRequests, salesSettings } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { draftSalesMessage, type SalesDraftFacts } from "@/ai/functions/sales";
import { EMPTY_DETAILS, MODE_LABEL, type QuoteDetails } from "@/domain/quote-rules";
import { offerPrice, type RoadCalculation } from "@/domain/sales-pricing";
import { createRng, seedFromString } from "@/simulation/random";
import { HttpError } from "../http";
import { saveDraft } from "../inbox/gateway";
import { scheduleEvent } from "../tick/engine";
import { rfqThread, storeAgentMessage } from "./gateway";
import { calculateRoad, loadQuote, loadSettings, progress, routeText, sendAckAndRfqs } from "./quotes";

const MIN = 60_000;

async function quoteOr404(db: Executor, sandboxId: string, id: string) {
  const q = await loadQuote(db, sandboxId, id);
  if (!q) throw new HttpError(404, "Nie ma takiej wyceny.");
  return q;
}

const setQuote = (db: Executor, sandboxId: string, id: string, patch: Partial<typeof quoteRequests.$inferInsert>) =>
  db.update(quoteRequests).set(patch).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, id)));

export const DetailsPatchSchema = z.object({
  origin: z.string().trim().max(80).nullable().optional(),
  destination: z.string().trim().max(80).nullable().optional(),
  incoterms: z.string().trim().max(3).nullable().optional(),
  containerType: z.enum(["20", "40", "40HC"]).nullable().optional(),
  containers: z.number().int().min(1).max(50).nullable().optional(),
  seaType: z.enum(["FCL", "LCL"]).nullable().optional(),
  packages: z.number().int().min(1).max(10000).nullable().optional(),
  pallets: z.number().int().min(1).max(66).nullable().optional(),
  weightKg: z.number().min(1).max(500000).nullable().optional(),
  volumeCbm: z.number().min(0.01).max(2000).nullable().optional(),
  commodity: z.string().trim().max(80).nullable().optional(),
  readyDate: z.string().trim().max(40).nullable().optional(),
  dangerous: z.boolean().optional(),
  reefer: z.boolean().optional(),
  vehicleKind: z.enum(["bus", "solo", "tractor"]).nullable().optional(),
});

/** Salesperson completes or corrects what was read from the inquiry; the flow continues from there. */
export async function updateDetails(db: Db, sandboxId: string, quoteId: string, patch: z.infer<typeof DetailsPatchSchema>, simNow: Date) {
  const q = await quoteOr404(db, sandboxId, quoteId);
  if (!["niekompletne", "do_zatwierdzenia", "gotowe"].includes(q.status) || (q.mode !== "road" && q.status === "gotowe")) {
    throw new HttpError(409, "Zapytania zostały już wysłane — danych nie można zmienić.");
  }
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === "" ? null : v]));
  await setQuote(db, sandboxId, quoteId, { details: { ...(q.details as object), ...clean } });
  await progress(db, sandboxId, quoteId, simNow);
}

export async function approveSending(db: Executor, sandboxId: string, quoteId: string, simNow: Date) {
  const q = await quoteOr404(db, sandboxId, quoteId);
  if (q.status !== "do_zatwierdzenia") throw new HttpError(409, "Ta wycena nie czeka na zatwierdzenie.");
  await sendAckAndRfqs(db, sandboxId, quoteId, simNow);
}

export async function selectRate(db: Executor, sandboxId: string, quoteId: string, agentQuoteId: string, marginPct: number) {
  await quoteOr404(db, sandboxId, quoteId);
  const [aq] = await db.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.id, agentQuoteId), eq(agentQuotes.requestId, quoteId)));
  if (!aq || aq.status !== "odpowiedz" || !aq.price) throw new HttpError(409, "Ten agent nie podał stawki.");
  await setQuote(db, sandboxId, quoteId, { selectedQuoteId: agentQuoteId, marginPct });
}

export async function recalcRoad(
  db: Executor,
  sandboxId: string,
  quoteId: string,
  opts: { kmOverride?: number | null; emptyKm?: number; marginPct?: number; vehicleKind?: "bus" | "solo" | "tractor" },
) {
  const q = await quoteOr404(db, sandboxId, quoteId);
  if (q.mode !== "road") throw new HttpError(409, "Kalkulator dotyczy tylko wycen drogowych.");
  const calc = await calculateRoad(db, sandboxId, quoteId, opts);
  if (!calc) throw new HttpError(409, "Brakuje kilometrów — wpisz je ręcznie.");
  return calc;
}

/** Offer facts from the system's own calculation (agent rate + margin, or road calculation). */
async function offerFacts(db: Executor, sandboxId: string, quoteId: string): Promise<SalesDraftFacts> {
  const q = await quoteOr404(db, sandboxId, quoteId);
  const d = { ...EMPTY_DETAILS, ...(q.details as Partial<QuoteDetails>) };
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, q.contactId)));
  const cargo = [
    d.containerType ? `${d.containers ?? 1} × ${d.containerType}'` : null,
    d.pallets ? `${d.pallets} palet` : d.packages ? `${d.packages} opakowań` : null,
    d.weightKg ? `${d.weightKg.toLocaleString("pl-PL")} kg` : null,
    d.volumeCbm ? `${d.volumeCbm} CBM` : null,
    d.commodity,
  ]
    .filter(Boolean)
    .join(", ");
  const base = { number: q.number, route: routeText(d), modeLabel: MODE_LABEL[q.mode], cargo, recipientName: contact?.name ?? "" };
  if (q.mode === "road") {
    const calc = q.calculation as RoadCalculation | null;
    if (!calc) throw new HttpError(409, "Najpierw policz wycenę drogową.");
    return { ...base, amount: calc.price, currency: calc.currency, transitDays: null, validUntil: "7 dni od daty oferty", conditions: [calc.surcharges.map((s) => s.label).join(", "), "cena netto za kurs"].filter(Boolean).join("; ") };
  }
  if (!q.selectedQuoteId || q.marginPct === null) throw new HttpError(409, "Wybierz stawkę agenta i marżę.");
  const [aq] = await db.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.id, q.selectedQuoteId)));
  return {
    ...base,
    amount: offerPrice(aq.price!, q.marginPct),
    currency: aq.currency ?? "EUR",
    transitDays: aq.transitDays,
    validUntil: aq.validUntil,
    conditions: aq.conditions,
  };
}

/** AI writes the offer around the computed price; it lands as a draft in the client's e-mail thread. */
export async function draftOffer(db: Db, sandboxId: string, quoteId: string, simNow: Date) {
  const q = await quoteOr404(db, sandboxId, quoteId);
  if (!q.sourceMessageId) throw new HttpError(409, "Wycena nie ma maila klienta.");
  const facts = await offerFacts(db, sandboxId, quoteId);
  const [src] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, q.sourceMessageId)));
  const old = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, src.threadKey), eq(messages.state, "draft"), eq(messages.kind, "draft_offer")));
  for (const o of old) await db.delete(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, o.id)));
  const outcome = await draftSalesMessage({ db, sandboxId, simNow, goal: "oferta", facts });
  return saveDraft(db, sandboxId, {
    threadKey: src.threadKey,
    contactId: q.contactId,
    subject: outcome.value.subject,
    body: outcome.value.body,
    atSim: simNow,
    kind: "draft_offer",
    classifiedBy: outcome.source === "ai" ? "ai" : "rules",
  });
}

/** AI drafts a request to an agent for a target rate; the agent's thread holds it until sent. */
export async function draftNegotiation(db: Db, sandboxId: string, quoteId: string, agentQuoteId: string, target: number, simNow: Date) {
  const q = await quoteOr404(db, sandboxId, quoteId);
  const [aq] = await db.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.id, agentQuoteId), eq(agentQuotes.requestId, quoteId)));
  if (!aq?.price || !aq.currency) throw new HttpError(409, "Negocjować można tylko podaną stawkę.");
  if (!(target > 0 && target < aq.price)) throw new HttpError(400, "Cena docelowa musi być niższa od stawki agenta.");
  const [agent] = await db.select().from(agents).where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, aq.agentId)));
  const d = { ...EMPTY_DETAILS, ...(q.details as Partial<QuoteDetails>) };
  const outcome = await draftSalesMessage({
    db,
    sandboxId,
    simNow,
    goal: "negocjacja",
    facts: { number: q.number, route: routeText(d), modeLabel: MODE_LABEL[q.mode], cargo: "", amount: Math.round(target), currency: aq.currency, transitDays: null, validUntil: null, conditions: null, recipientName: agent.contactName },
  });
  const id = await storeAgentMessage(db, sandboxId, {
    agentId: agent.id,
    threadKey: rfqThread(quoteId, agent.id),
    direction: "out",
    subject: outcome.value.subject,
    body: outcome.value.body,
    atSim: simNow,
    state: "draft",
    sentBy: "system",
    kind: "negotiation",
    classifiedBy: outcome.source === "ai" ? "ai" : "rules",
  });
  await db.update(messages).set({ aiExtracted: { target: Math.round(target), agentQuoteId } }).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, id)));
  return id;
}

/** Sends (demo: stores) a negotiation draft; the agent bot answers later. */
export async function sendAgentDraft(db: Executor, sandboxId: string, messageId: string, edit: { subject: string; body: string }, simNow: Date) {
  const [m] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId), eq(messages.party, "agent")));
  if (!m || m.state !== "draft") throw new HttpError(409, "Ta wiadomość została już wysłana.");
  await db.update(messages).set({ state: "sent", sentBy: "dispatcher", subject: edit.subject.slice(0, 200), body: edit.body.slice(0, 4000), atSim: simNow }).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  const meta = m.aiExtracted as { target?: number; agentQuoteId?: string } | null;
  if (meta?.target && meta.agentQuoteId) {
    const quoteId = m.threadKey.split(":")[1];
    const rng = createRng(seedFromString(`${sandboxId}:${messageId}`));
    await scheduleEvent(db, sandboxId, { dueSim: new Date(simNow.getTime() + rng.int(30, 90) * MIN), type: "bot.agent_negotiation", payload: { quoteId, agentQuoteId: meta.agentQuoteId, target: meta.target } });
  }
}

export async function discardAgentDraft(db: Executor, sandboxId: string, messageId: string) {
  const [m] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId), eq(messages.party, "agent")));
  if (!m || m.state !== "draft") throw new HttpError(409, "Wysłanej wiadomości nie można odrzucić.");
  await db.delete(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
}

export async function setOutcome(db: Executor, sandboxId: string, quoteId: string, outcome: "wygrana" | "przegrana" | "anulowana", simNow: Date) {
  await quoteOr404(db, sandboxId, quoteId);
  await setQuote(db, sandboxId, quoteId, { status: outcome, closedSim: simNow });
}

export const SettingsSchema = z.object({
  autoSend: z.boolean().optional(),
  defaultMarginPct: z.number().min(0).max(100).optional(),
  adrSurchargePct: z.number().min(0).max(200).optional(),
  reeferSurchargePct: z.number().min(0).max(200).optional(),
  roadRates: z
    .array(
      z.object({
        kind: z.enum(["bus", "solo", "tractor"]),
        label: z.string().max(80),
        perKmPln: z.number().min(0.1).max(100),
        perKmEur: z.number().min(0.05).max(30),
        minPln: z.number().min(0).max(100000),
        minEur: z.number().min(0).max(30000),
      }),
    )
    .length(3)
    .optional(),
});

export async function updateSettings(db: Executor, sandboxId: string, patch: z.infer<typeof SettingsSchema>) {
  await loadSettings(db, sandboxId);
  await db.update(salesSettings).set(patch).where(eq(salesSettings.sandboxId, sandboxId));
}

export async function setAgentActive(db: Executor, sandboxId: string, agentId: string, active: boolean) {
  const res = await db.update(agents).set({ active }).where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, agentId))).returning({ id: agents.id });
  if (res.length === 0) throw new HttpError(404, "Nie ma takiego agenta.");
}
