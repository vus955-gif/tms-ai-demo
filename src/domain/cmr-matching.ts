/**
 * Which order does a photographed CMR belong to (spec §7.7)? Scores 0–1 from
 * the fields AI read: reference numbers, delivery city, consignee, date. The
 * computation is deterministic; AI only reads the fields.
 */

export type CmrFields = {
  cmr_number?: string | null;
  sender?: string | null;
  consignee?: string | null;
  place_of_delivery?: string | null;
  delivery_date?: string | null;
  references?: string[] | null;
};

export type CmrCandidate = {
  orderId: string;
  number: string;
  references: string[];
  deliveryCity: string;
  consigneeNames: string[];
  /** dd.mm or yyyy-mm-dd of the actual delivery, if known. */
  deliveryDates: string[];
};

export type CmrMatch = { orderId: string; number: string; score: number; reasons: string[] };

export const CMR_AUTO_THRESHOLD = 0.85;

const WEIGHTS = { references: 0.45, city: 0.25, consignee: 0.2, date: 0.1 };

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const compact = (s: string) => normalize(s).replace(/\s+/g, "");

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalize(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

export function scoreCmr(fields: CmrFields, candidate: CmrCandidate): CmrMatch {
  const reasons: string[] = [];
  let score = 0;
  const refs = (fields.references ?? []).map(compact).filter((x) => x.length >= 4);
  // Exact, or one contains the other with at most two characters of OCR noise ("PO-12" must not match "PO-1234").
  const close = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 6 && Math.abs(a.length - b.length) <= 2 && (a.includes(b) || b.includes(a)));
  const refHit = candidate.references.find((r) => compact(r).length >= 4 && refs.some((x) => close(x, compact(r))));
  if (refHit) {
    score += WEIGHTS.references;
    reasons.push(`numer referencyjny ${refHit}`);
  }
  if (fields.place_of_delivery && normalize(fields.place_of_delivery).includes(normalize(candidate.deliveryCity))) {
    score += WEIGHTS.city;
    reasons.push(`miejsce dostawy ${candidate.deliveryCity}`);
  }
  if (fields.consignee && candidate.consigneeNames.some((n) => tokenOverlap(fields.consignee!, n) >= 0.5)) {
    score += WEIGHTS.consignee;
    reasons.push("odbiorca się zgadza");
  }
  if (fields.delivery_date && candidate.deliveryDates.some((d) => compact(fields.delivery_date!).includes(compact(d)))) {
    score += WEIGHTS.date;
    reasons.push("data się zgadza");
  }
  return { orderId: candidate.orderId, number: candidate.number, score: Math.round(score * 100) / 100, reasons };
}

export function matchCmr(fields: CmrFields, candidates: CmrCandidate[]): CmrMatch[] {
  return candidates.map((c) => scoreCmr(fields, c)).sort((a, b) => b.score - a.score);
}
