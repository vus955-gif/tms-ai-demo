import { and, eq, inArray } from "drizzle-orm";
import { agentQuotes, agents, quoteRequests } from "@/db/schema";
import { CARRIER_SIGNATURE } from "@/domain/carrier";
import { EMPTY_DETAILS, type QuoteDetails } from "@/domain/quote-rules";
import { agentRate, agentReplyText, negotiationReplyText, noSpaceText } from "@/simulation/bots/agent-replies";
import { createRng, seedFromString } from "@/simulation/random";
import { agentsSeed } from "@/simulation/scenario/agents";
import { findPlace } from "@/domain/gazetteer";
import { onDraftSent } from "../inbox/actions";
import { onQuoteInquiry } from "../inbox/process";
import { registerEventHandler, type TickContext } from "../tick/registry";
import { rfqThread, storeAgentMessage } from "./gateway";
import { createQuoteFromEmail, loadQuote, markReadyWhenAllAnswered, processAgentReply, routeText } from "./quotes";

onQuoteInquiry(async (db, info) => {
  await createQuoteFromEmail(db, info.sandboxId, info.messageId, { simNow: info.simNow, skipAi: info.skipAi });
});

/** The offer draft went out from the client thread → the quote is "offer sent". */
onDraftSent(async (db, { sandboxId, message }) => {
  if (message.kind !== "draft_offer") return;
  const rootId = message.threadKey.replace(/^email:/, "");
  await db
    .update(quoteRequests)
    .set({ status: "oferta_wyslana" })
    .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.sourceMessageId, rootId), inArray(quoteRequests.status, ["gotowe", "zbieranie"])));
});

const language = (agentId: string) => agentsSeed.find((a) => a.id === agentId)?.language ?? "pl";

function readLater(ctx: TickContext, messageId: string) {
  const sandboxId = ctx.sandbox.id;
  const simNow = ctx.simNow;
  const skipAi = ctx.isStale(simNow);
  ctx.afterCommit(async (db) => {
    await processAgentReply(db, sandboxId, messageId, { simNow, skipAi });
  });
}

/** Demo bot: an agent answers an RFQ with a rate or "no space". */
registerEventHandler("bot.agent_reply", async (ctx, event) => {
  const p = event.payload as { quoteId: string; agentQuoteId: string; noSpace: boolean };
  const [aq] = await ctx.tx.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, ctx.sandbox.id), eq(agentQuotes.id, p.agentQuoteId)));
  if (!aq || !["wyslane", "przypomniane"].includes(aq.status)) return;
  const quote = await loadQuote(ctx.tx, ctx.sandbox.id, p.quoteId);
  if (!quote || ["wygrana", "przegrana", "anulowana"].includes(quote.status)) return;
  const [agent] = await ctx.tx.select().from(agents).where(and(eq(agents.sandboxId, ctx.sandbox.id), eq(agents.id, aq.agentId)));
  const details = { ...EMPTY_DETAILS, ...(quote.details as Partial<QuoteDetails>) };
  const lang = language(agent.id);
  const rng = createRng(seedFromString(`${ctx.sandbox.id}:${aq.id}:rate`));
  const body = p.noSpace
    ? noSpaceText(lang, quote.number, agent.contactName)
    : agentReplyText({
        language: lang,
        number: quote.number,
        route: routeText(details),
        rate: agentRate(quote.mode, details, findPlace(details.destination)?.country ?? null, agent.priceFactor, rng),
        contactName: agent.contactName,
        now: ctx.simNow,
      });
  const messageId = await storeAgentMessage(ctx.tx, ctx.sandbox.id, {
    agentId: agent.id,
    threadKey: rfqThread(quote.id, agent.id),
    direction: "in",
    subject: `${lang === "en" ? "RE" : "Re"}: Zapytanie ${quote.number}`,
    body,
    atSim: ctx.simNow,
    state: "received",
    sentBy: "agent",
    kind: "agent_reply",
  });
  readLater(ctx, messageId);
});

/** Agents that have not answered get a reminder. */
registerEventHandler("sales.reminder", async (ctx, event) => {
  const { quoteId } = event.payload as { quoteId: string };
  const quote = await loadQuote(ctx.tx, ctx.sandbox.id, quoteId);
  if (!quote || quote.status !== "zbieranie") return;
  const waiting = await ctx.tx.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, ctx.sandbox.id), eq(agentQuotes.requestId, quoteId), eq(agentQuotes.status, "wyslane")));
  for (const aq of waiting) {
    await ctx.tx.update(agentQuotes).set({ status: "przypomniane" }).where(and(eq(agentQuotes.sandboxId, ctx.sandbox.id), eq(agentQuotes.id, aq.id)));
    await storeAgentMessage(ctx.tx, ctx.sandbox.id, {
      agentId: aq.agentId,
      threadKey: rfqThread(quoteId, aq.agentId),
      direction: "out",
      subject: `Przypomnienie: zapytanie ${quote.number}`,
      body: `Dzień dobry,\n\nuprzejmie przypominamy o zapytaniu ${quote.number}. Czy możemy liczyć na stawkę?\n\nPozdrawiam\n${CARRIER_SIGNATURE}`,
      atSim: ctx.simNow,
      state: "sent",
      sentBy: "system",
      kind: "rfq_reminder",
    });
  }
});

/** After the deadline, silent agents are marked and the quote is ready for the salesperson. */
registerEventHandler("sales.deadline", async (ctx, event) => {
  const { quoteId } = event.payload as { quoteId: string };
  await ctx.tx
    .update(agentQuotes)
    .set({ status: "brak_odpowiedzi" })
    .where(and(eq(agentQuotes.sandboxId, ctx.sandbox.id), eq(agentQuotes.requestId, quoteId), inArray(agentQuotes.status, ["wyslane", "przypomniane"])));
  await markReadyWhenAllAnswered(ctx.tx, ctx.sandbox.id, quoteId);
});

/** Demo bot: an agent answers a negotiation — accepts or meets halfway. */
registerEventHandler("bot.agent_negotiation", async (ctx, event) => {
  const p = event.payload as { quoteId: string; agentQuoteId: string; target: number };
  const [aq] = await ctx.tx.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, ctx.sandbox.id), eq(agentQuotes.id, p.agentQuoteId)));
  if (!aq?.price || !aq.currency) return;
  const quote = await loadQuote(ctx.tx, ctx.sandbox.id, p.quoteId);
  const [agent] = await ctx.tx.select().from(agents).where(and(eq(agents.sandboxId, ctx.sandbox.id), eq(agents.id, aq.agentId)));
  const rng = createRng(seedFromString(`${ctx.sandbox.id}:${aq.id}:${p.target}`));
  const accepted = p.target >= aq.price * 0.9 && rng.chance(0.7);
  const price = accepted ? p.target : Math.round((aq.price + p.target) / 2);
  const lang = language(agent.id);
  const messageId = await storeAgentMessage(ctx.tx, ctx.sandbox.id, {
    agentId: agent.id,
    threadKey: rfqThread(quote.id, agent.id),
    direction: "in",
    subject: `${lang === "en" ? "RE" : "Re"}: ${quote.number}: prośba o weryfikację stawki`,
    body: negotiationReplyText({ language: lang, number: quote.number, accepted, price, currency: aq.currency, contactName: agent.contactName }),
    atSim: ctx.simNow,
    state: "received",
    sentBy: "agent",
    kind: "agent_reply",
  });
  readLater(ctx, messageId);
});

