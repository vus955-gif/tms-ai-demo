import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { agentQuotes, agents, clientContacts, clients, messages, points, quoteRequests, salesSettings, type QuoteMode } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { extractQuoteRequest, readAgentReply } from "@/ai/functions/sales";
import { getRouteByKey, hasRouteKey } from "@/adapters/routing/static-routes";
import { CARRIER_SIGNATURE } from "@/domain/carrier";
import { findPlace, greatCircleKm, ROAD_DETOUR_FACTOR } from "@/domain/gazetteer";
import { normalize } from "@/domain/email-rules";
import { EMPTY_DETAILS, MODE_LABEL, missingFor, rfqSummary, roadVehicleFor, type QuoteDetails } from "@/domain/quote-rules";
import { roadCalculation, type RoadCalculation } from "@/domain/sales-pricing";
import { formatSimClock } from "@/lib/format";
import { routeKey } from "@/simulation/route-geometry";
import { createRng, seedFromString } from "@/simulation/random";
import { storeClientOutbound } from "../inbox/gateway";
import { prepareReplyDraft } from "../inbox/process";
import { scheduleEvent } from "../tick/engine";
import { rfqThread, storeAgentMessage } from "./gateway";

const MIN = 60_000;
export const REMINDER_AFTER_MIN = 180;
export const DEADLINE_AFTER_MIN = 480;

export type QuoteRow = typeof quoteRequests.$inferSelect;

export async function loadQuote(db: Executor, sandboxId: string, id: string) {
  const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, id)));
  return q;
}

export async function loadSettings(db: Executor, sandboxId: string) {
  const [s] = await db.select().from(salesSettings).where(eq(salesSettings.sandboxId, sandboxId));
  return s;
}

async function nextQuoteNumber(db: Executor, sandboxId: string) {
  const rows = await db.select({ number: quoteRequests.number }).from(quoteRequests).where(eq(quoteRequests.sandboxId, sandboxId));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.replace(/\D/g, "")) || 0), 1000);
  return `WY-${max + 1}`;
}

export const routeText = (d: Pick<QuoteDetails, "origin" | "destination">) => `${d.origin ?? "?"} → ${d.destination ?? "?"}`;

/** A client's inquiry (category "zapytanie ofertowe") becomes a quote request. */
export async function createQuoteFromEmail(db: Db, sandboxId: string, messageId: string, opts: { simNow: Date; skipAi?: boolean }) {
  const existing = await db.select({ id: quoteRequests.id }).from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.sourceMessageId, messageId)));
  if (existing[0]) return existing[0].id;
  const [msg] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  if (!msg?.clientContactId) return null;
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, msg.clientContactId)));
  const { value, source } = await extractQuoteRequest({ db, sandboxId, simNow: opts.simNow, subject: msg.subject ?? "", body: msg.body, skipAi: opts.skipAi });
  const { mode, ...details } = value;
  const id = randomUUID();
  await db.insert(quoteRequests).values({
    sandboxId,
    id,
    number: await nextQuoteNumber(db, sandboxId),
    mode,
    status: "niekompletne",
    clientId: contact.clientId,
    contactId: contact.id,
    sourceMessageId: messageId,
    details: details as Record<string, unknown>,
    missingFields: [],
    extractedBy: source === "ai" ? "ai" : "rules",
    createdSim: msg.atSim,
  });
  await progress(db, sandboxId, id, msg.atSim, { skipAi: opts.skipAi, askClient: true });
  return id;
}

/**
 * Decides the next step after the details changed: incomplete → ask the client;
 * sea/air/rail complete → acknowledge and send RFQs (or wait for approval);
 * road complete → calculate from the own rates.
 */
export async function progress(db: Db, sandboxId: string, quoteId: string, simNow: Date, opts: { skipAi?: boolean; askClient?: boolean } = {}) {
  const quote = await loadQuote(db, sandboxId, quoteId);
  const details = { ...EMPTY_DETAILS, ...(quote.details as Partial<QuoteDetails>) };
  const missing = missingFor(quote.mode, details);
  await db.update(quoteRequests).set({ missingFields: missing }).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
  if (missing.length > 0) {
    await db.update(quoteRequests).set({ status: "niekompletne" }).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
    if (opts.askClient && quote.sourceMessageId) {
      const [src] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, quote.sourceMessageId)));
      await prepareReplyDraft(db, sandboxId, {
        goal: "prosba_o_brakujace_dane",
        threadKey: src.threadKey,
        contactId: quote.contactId,
        orderId: null,
        email: { subject: src.subject ?? "", body: src.body },
        missing,
        simNow,
        skipAi: opts.skipAi,
        kind: "draft_quote_missing",
      });
    }
    return;
  }
  if (quote.mode === "road") {
    await calculateRoad(db, sandboxId, quoteId, {});
    return;
  }
  if (!["niekompletne", "do_zatwierdzenia"].includes(quote.status)) return;
  const settings = await loadSettings(db, sandboxId);
  if (settings.autoSend) await sendAckAndRfqs(db, sandboxId, quoteId, simNow);
  else await db.update(quoteRequests).set({ status: "do_zatwierdzenia" }).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
}

const ACK_TEXT = "Dziękujemy za przesłanie zapytania — powrócimy z wyceną jak najszybciej.";

/** Thanks the client and sends the RFQ to every active agent for this mode — without client data. */
export async function sendAckAndRfqs(db: Executor, sandboxId: string, quoteId: string, simNow: Date) {
  const quote = await loadQuote(db, sandboxId, quoteId);
  const details = { ...EMPTY_DETAILS, ...(quote.details as Partial<QuoteDetails>) };
  if (quote.sourceMessageId) {
    const [src] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, quote.sourceMessageId)));
    await storeClientOutbound(db, sandboxId, {
      threadKey: src.threadKey,
      contactId: quote.contactId,
      subject: `Re: ${(src.subject ?? "").replace(/^re:\s*/i, "")}`,
      body: `Dzień dobry,\n\n${ACK_TEXT}\nNumer zapytania: ${quote.number}.\n\nPozdrawiam\n${CARRIER_SIGNATURE}`,
      atSim: simNow,
      kind: "quote_ack",
    });
  }
  const list = (await db.select().from(agents).where(and(eq(agents.sandboxId, sandboxId), eq(agents.active, true)))).filter((a) => a.modes.includes(quote.mode));
  const deadline = new Date(simNow.getTime() + DEADLINE_AFTER_MIN * MIN);
  const summary = rfqSummary(quote.mode, details);
  for (const agent of list) {
    const aqId = randomUUID();
    await db.insert(agentQuotes).values({ sandboxId, id: aqId, requestId: quoteId, agentId: agent.id, status: "wyslane", sentSim: simNow });
    await storeAgentMessage(db, sandboxId, {
      agentId: agent.id,
      threadKey: rfqThread(quoteId, agent.id),
      direction: "out",
      subject: `Zapytanie ${quote.number}: ${MODE_LABEL[quote.mode]} ${routeText(details)}`,
      body: `Dzień dobry,\n\nprosimy o stawkę dla poniższej wysyłki:\n\n${summary}\n\nProsimy o odpowiedź do ${formatSimClock(deadline)}.\n\nPozdrawiam\n${CARRIER_SIGNATURE}`,
      atSim: simNow,
      state: "sent",
      sentBy: "system",
      kind: "rfq",
    });
    // Demo bots: some agents answer (a few with "no space"), some stay silent.
    const rng = createRng(seedFromString(`${sandboxId}:${quoteId}:${agent.id}`));
    if (rng.chance(agent.replyRate)) {
      await scheduleEvent(db, sandboxId, {
        dueSim: new Date(simNow.getTime() + rng.int(20, 300) * MIN),
        type: "bot.agent_reply",
        payload: { quoteId, agentQuoteId: aqId, noSpace: rng.chance(0.12) },
      });
    }
  }
  await scheduleEvent(db, sandboxId, { dueSim: new Date(simNow.getTime() + REMINDER_AFTER_MIN * MIN), type: "sales.reminder", payload: { quoteId } });
  await scheduleEvent(db, sandboxId, { dueSim: deadline, type: "sales.deadline", payload: { quoteId } });
  await db
    .update(quoteRequests)
    .set({ status: list.length > 0 ? "zbieranie" : "gotowe", deadlineSim: deadline })
    .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
}

/** Road km: the stored OSRM route when both places are the client's known points, otherwise an estimate. */
async function roadKm(db: Executor, sandboxId: string, clientId: string, d: QuoteDetails): Promise<{ km: number; source: "trasa" | "szacunek"; domestic: boolean } | null> {
  const own = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, clientId)));
  const match = (name: string | null) => (name ? own.find((p) => normalize(p.city) === normalize(name) || normalize(name).includes(normalize(p.city))) : undefined);
  const a = match(d.origin);
  const b = match(d.destination);
  if (a && b && a.id !== b.id && hasRouteKey(routeKey(a.id, b.id))) {
    return { km: getRouteByKey(routeKey(a.id, b.id)).distanceM / 1000, source: "trasa", domestic: a.country === "PL" && b.country === "PL" };
  }
  const pa = findPlace(d.origin);
  const pb = findPlace(d.destination);
  if (!pa || !pb || !pa.europe || !pb.europe) return null;
  return { km: greatCircleKm(pa, pb) * ROAD_DETOUR_FACTOR, source: "szacunek", domestic: pa.country === "PL" && pb.country === "PL" };
}

export async function calculateRoad(
  db: Executor,
  sandboxId: string,
  quoteId: string,
  opts: { kmOverride?: number | null; emptyKm?: number; marginPct?: number; vehicleKind?: "bus" | "solo" | "tractor" | null },
): Promise<RoadCalculation | null> {
  const quote = await loadQuote(db, sandboxId, quoteId);
  const settings = await loadSettings(db, sandboxId);
  const details = { ...EMPTY_DETAILS, ...(quote.details as Partial<QuoteDetails>) };
  const previous = quote.calculation as (RoadCalculation & { kmOverride?: number | null }) | null;
  const kind = opts.vehicleKind ?? previous?.vehicleKind ?? roadVehicleFor(details) ?? "tractor";
  const rate = settings.roadRates.find((r) => r.kind === kind) ?? settings.roadRates[settings.roadRates.length - 1];
  const km = await roadKm(db, sandboxId, quote.clientId, details);
  const override = opts.kmOverride !== undefined ? opts.kmOverride : (previous?.kmOverride ?? null);
  if (!km && !override) {
    await db
      .update(quoteRequests)
      .set({ status: "niekompletne", missingFields: ["km trasy (nieznane miasto — wpisz km ręcznie)"] })
      .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
    return null;
  }
  const origin = findPlace(details.origin);
  const destination = findPlace(details.destination);
  const domestic = km?.domestic ?? (origin?.country === "PL" && destination?.country === "PL");
  const calc = roadCalculation({
    rate,
    domestic,
    loadedKm: override ?? km!.km,
    emptyKm: opts.emptyKm ?? previous?.emptyKm ?? 0,
    kmSource: override ? "trasa" : km!.source,
    adr: details.dangerous,
    reefer: details.reefer,
    adrPct: settings.adrSurchargePct,
    reeferPct: settings.reeferSurchargePct,
    marginPct: opts.marginPct ?? quote.marginPct ?? settings.defaultMarginPct,
  });
  const stored = { ...calc, kmOverride: override, kmLabel: override ? "wpisane ręcznie" : km!.source === "trasa" ? "trasa z bazy punktów (OSRM)" : `szacunek: linia prosta × ${ROAD_DETOUR_FACTOR}` };
  await db
    .update(quoteRequests)
    .set({
      calculation: stored as unknown as Record<string, unknown>,
      marginPct: calc.marginPct,
      missingFields: [],
      status: ["niekompletne", "do_zatwierdzenia", "zbieranie"].includes(quote.status) ? "gotowe" : quote.status,
    })
    .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
  return calc;
}

/** A rate (or "no space") from an agent: read it and update the comparison. */
export async function processAgentReply(db: Db, sandboxId: string, messageId: string, opts: { simNow: Date; skipAi?: boolean }) {
  const [msg] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  if (!msg?.agentId) return;
  const quoteId = msg.threadKey.split(":")[1];
  const [aq] = await db.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.requestId, quoteId), eq(agentQuotes.agentId, msg.agentId)));
  if (!aq) return;
  const quote = await loadQuote(db, sandboxId, quoteId);
  const { value: r, source } = await readAgentReply({ db, sandboxId, simNow: opts.simNow, body: msg.body, inputRef: `Odpowiedź agenta: ${quote.number}`, skipAi: opts.skipAi });
  await db.update(messages).set({ classifiedBy: source === "ai" ? "ai" : "rules", aiExtracted: r as unknown as Record<string, unknown> }).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  await db
    .update(agentQuotes)
    .set(
      r.available
        ? { status: "odpowiedz", price: r.price, currency: r.currency, validUntil: r.valid_until, transitDays: r.transit_days, conditions: r.conditions, readBy: source === "ai" ? "ai" : "rules", repliedSim: msg.atSim }
        : { status: "brak_miejsca", readBy: source === "ai" ? "ai" : "rules", repliedSim: msg.atSim },
    )
    .where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.id, aq.id)));
  await markReadyWhenAllAnswered(db, sandboxId, quoteId);
}

export async function markReadyWhenAllAnswered(db: Executor, sandboxId: string, quoteId: string) {
  const quote = await loadQuote(db, sandboxId, quoteId);
  if (quote.status !== "zbieranie") return;
  const rows = await db.select({ status: agentQuotes.status }).from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.requestId, quoteId)));
  if (rows.every((r) => ["odpowiedz", "brak_miejsca", "brak_odpowiedzi"].includes(r.status))) {
    await db.update(quoteRequests).set({ status: "gotowe" }).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
  }
}

export async function openQuotesCount(db: Executor, sandboxId: string): Promise<number> {
  const rows = await db
    .select({ id: quoteRequests.id })
    .from(quoteRequests)
    .where(and(eq(quoteRequests.sandboxId, sandboxId), inArray(quoteRequests.status, ["niekompletne", "do_zatwierdzenia", "gotowe"])));
  return rows.length;
}

export const quoteModeLabel = (m: QuoteMode) => MODE_LABEL[m];

/** Used by the client view of the inquiry (Skrzynka) to link to the quote. */
export async function quoteForMessage(db: Executor, sandboxId: string, messageId: string) {
  const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.sourceMessageId, messageId)));
  return q ?? null;
}

export async function clientNameOf(db: Executor, sandboxId: string, clientId: string) {
  const [c] = await db.select({ name: clients.name }).from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, clientId)));
  return c?.name ?? "";
}
