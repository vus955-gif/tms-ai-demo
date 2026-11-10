import { and, eq } from "drizzle-orm";
import { explainRanking } from "@/ai/functions/explain-ranking";
import { clients, quoteRequests } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { clampWeight, type RankingFacts } from "@/domain/offer-ranking";
import { money } from "@/domain/sales-pricing";
import { HttpError } from "../http";
import { quoteDetail } from "./views";

/**
 * The quoting profile belongs to the client, not to one quote: set while working on a quote,
 * it applies to every later inquiry from the same client.
 */
export async function setClientQuoteProfile(db: Executor, sandboxId: string, quoteId: string, input: { priceWeight: number; note: string }) {
  const [q] = await db.select({ clientId: quoteRequests.clientId }).from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
  if (!q) throw new HttpError(404, "Nie ma takiej wyceny.");
  await db
    .update(clients)
    .set({ quotePriceWeight: clampWeight(input.priceWeight), quoteNote: input.note.trim().slice(0, 300) })
    .where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, q.clientId)));
}

/** The ranked rates of a quote as facts for the recommendation (the same numbers the table shows). */
export async function rankingFacts(db: Executor, sandboxId: string, quoteId: string): Promise<{ facts: RankingFacts; number: string }> {
  const quote = await quoteDetail(db, sandboxId, quoteId);
  const byId = new Map(quote.agents.map((a) => [a.agentQuoteId, a]));
  return {
    number: quote.number,
    facts: {
      client: quote.client.name,
      profile: quote.profile.label,
      priceWeight: quote.profile.priceWeight,
      clientNote: quote.profile.note,
      offers: quote.ranking.map((r) => {
        const a = byId.get(r.id)!;
        return { company: a.company, price: money(a.price ?? 0, a.currency ?? ""), transit: a.transitDays ? `${a.transitDays} dni` : "brak czasu tranzytu", fitPct: r.fitPct, reasons: r.reasons, conditions: a.conditions, validUntil: a.validUntil };
      }),
      note: quote.rankingNote,
    },
  };
}

/** "Wyjaśnij ranking": the recommendation in words. The order of the offers is the algorithm's and does not change. */
export async function explainQuoteRanking(db: Db, sandboxId: string, quoteId: string, simNow: Date): Promise<{ text: string; source: "ai" | "fallback" }> {
  const { facts, number } = await rankingFacts(db, sandboxId, quoteId);
  if (facts.offers.length === 0) throw new HttpError(409, "Żaden agent nie podał jeszcze stawki: nie ma czego porównywać.");
  return explainRanking({ db, sandboxId, simNow, facts, quoteNumber: number });
}
