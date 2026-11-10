/**
 * "Która oferta pasuje do tego klienta?" — agents' rates ranked against the client's quoting profile.
 * The ranking is arithmetic done here; AI only words the recommendation, and the salesperson decides.
 *
 * Profile: one number, the weight of price (0–100). The rest is the weight of transit time.
 * 85 = "cheap matters, a few more days do not"; 15 = "as fast as possible, price is secondary".
 */

export const PROFILE_PRESETS = [
  { id: "najtaniej", label: "Najtaniej", priceWeight: 85 },
  { id: "zrownowazony", label: "Zrównoważony", priceWeight: 50 },
  { id: "najszybciej", label: "Najszybciej", priceWeight: 15 },
] as const;

export function profileLabel(priceWeight: number): string {
  if (priceWeight >= 70) return "liczy się głównie cena";
  if (priceWeight <= 30) return "liczy się głównie czas";
  return "cena i czas są równie ważne";
}

export const clampWeight = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export type Offer = { id: string; price: number; currency: string; transitDays: number | null };
export type RankedOffer = { id: string; fitPct: number; reasons: string[] };
export type Ranking = { ranked: RankedOffer[]; note: string | null };

const pct = (ratio: number) => Math.round((ratio - 1) * 100);
const days = (n: number) => (n === 1 ? "1 dzień" : `${n} dni`);

/**
 * Each offer scores best/own on price and on transit time (the cheapest and the fastest get 1),
 * weighted by the profile. An offer that is both the cheapest and the fastest fits 100%.
 * Offers in different currencies cannot be compared on price without an exchange rate the system
 * does not have: the ranking then uses time only and says so.
 */
export function rankOffers(offers: Offer[], priceWeight: number): Ranking {
  if (offers.length === 0) return { ranked: [], note: null };
  const w = clampWeight(priceWeight);
  const sameCurrency = new Set(offers.map((o) => o.currency)).size === 1;
  const minPrice = Math.min(...offers.map((o) => o.price));
  const timed = offers.filter((o) => o.transitDays !== null && o.transitDays > 0);
  const minDays = timed.length ? Math.min(...timed.map((o) => o.transitDays!)) : null;
  const priceShare = sameCurrency ? w : 0;
  const timeShare = sameCurrency ? 100 - w : 100;

  const ranked = offers
    .map((o) => {
      const priceScore = sameCurrency ? minPrice / o.price : 0;
      // An offer without a transit time is neither rewarded nor punished for it.
      const timeScore = o.transitDays && minDays ? minDays / o.transitDays : 0.5;
      const reasons: string[] = [];
      if (sameCurrency) reasons.push(o.price === minPrice ? "najtańsza" : `o ${pct(o.price / minPrice)}% droższa od najtańszej`);
      if (o.transitDays && minDays) reasons.push(o.transitDays === minDays ? "najszybsza" : `o ${days(o.transitDays - minDays)} dłużej niż najszybsza`);
      else reasons.push("agent nie podał czasu tranzytu");
      return { id: o.id, fitPct: Math.round((priceShare * priceScore + timeShare * timeScore) / 100 * 100), reasons, price: o.price };
    })
    // Ties go to the cheaper offer, then to a stable order.
    .sort((a, b) => b.fitPct - a.fitPct || a.price - b.price || a.id.localeCompare(b.id))
    .map(({ id, fitPct, reasons }) => ({ id, fitPct, reasons }));

  return { ranked, note: sameCurrency ? null : "Oferty są w różnych walutach, więc ranking porównuje tylko czas tranzytu. Ceny porównaj po przeliczeniu." };
}

export type RankingFacts = {
  client: string;
  profile: string;
  priceWeight: number;
  clientNote: string;
  offers: { company: string; price: string; transit: string; fitPct: number; reasons: string[]; conditions: string | null; validUntil: string | null }[];
  note: string | null;
};

/** The recommendation without AI: the top offer and why, then the runner-up. */
export function rankingTextByRules(f: RankingFacts): string {
  const [best, next] = f.offers;
  if (!best) return "Żaden agent nie podał jeszcze stawki.";
  const lines = [`Najbliżej profilu klienta (${f.profile}) jest oferta ${best.company}: ${best.price}, ${best.transit}; ${best.reasons.join(", ")}. Dopasowanie ${best.fitPct}%.`];
  if (next) lines.push(`Druga w kolejności: ${next.company} (${next.fitPct}%): ${next.reasons.join(", ")}.`);
  if (f.note) lines.push(f.note);
  return lines.join(" ");
}
