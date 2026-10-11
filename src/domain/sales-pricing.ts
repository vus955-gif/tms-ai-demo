import type { RoadRate } from "@/db/schema";

/**
 * Sales calculations. Every amount in an offer comes from here — AI drafts
 * only wrap these numbers in words, and a draft with another amount is rejected.
 */

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Offer price from a purchase price and a margin in percent (rounded up to a whole unit). */
export function offerPrice(purchase: number, marginPct: number): number {
  return Math.ceil(round2(purchase * (1 + marginPct / 100)));
}

export type RoadCalculation = {
  vehicleKind: RoadRate["kind"];
  vehicleLabel: string;
  currency: "PLN" | "EUR";
  loadedKm: number;
  emptyKm: number;
  kmSource: "trasa" | "szacunek";
  perKm: number;
  base: number;
  minimum: number;
  surcharges: { label: string; pct: number; amount: number }[];
  cost: number;
  marginPct: number;
  price: number;
};

export function roadCalculation(input: {
  rate: RoadRate;
  domestic: boolean;
  loadedKm: number;
  emptyKm?: number;
  kmSource: "trasa" | "szacunek";
  adr: boolean;
  reefer: boolean;
  adrPct: number;
  reeferPct: number;
  marginPct: number;
}): RoadCalculation {
  const currency = input.domestic ? "PLN" : "EUR";
  const perKm = input.domestic ? input.rate.perKmPln : input.rate.perKmEur;
  const minimum = input.domestic ? input.rate.minPln : input.rate.minEur;
  const km = Math.round(input.loadedKm) + Math.round(input.emptyKm ?? 0);
  const base = round2(Math.max(km * perKm, minimum));
  const surcharges = [
    input.adr ? { label: "ADR", pct: input.adrPct, amount: round2((base * input.adrPct) / 100) } : null,
    input.reefer ? { label: "chłodnia", pct: input.reeferPct, amount: round2((base * input.reeferPct) / 100) } : null,
  ].filter((s): s is { label: string; pct: number; amount: number } => s !== null);
  const cost = round2(base + surcharges.reduce((sum, s) => sum + s.amount, 0));
  return {
    vehicleKind: input.rate.kind,
    vehicleLabel: input.rate.label,
    currency,
    loadedKm: Math.round(input.loadedKm),
    emptyKm: Math.round(input.emptyKm ?? 0),
    kmSource: input.kmSource,
    perKm,
    base,
    minimum,
    surcharges,
    cost,
    marginPct: input.marginPct,
    price: offerPrice(cost, input.marginPct),
  };
}

/** 2470 → "2 470" (Polish locale does not group four-digit numbers, offers should). */
export const groupThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** "1 150 USD" — the format used in drafts and checked in AI output. */
export function money(amount: number, currency: string): string {
  return `${groupThousands(Math.round(amount))} ${currency}`;
}

/** Does an AI draft state exactly this amount (any thousands separator)? */
export function mentionsAmount(text: string, amount: number): boolean {
  const digits = String(Math.round(amount));
  const normalized = text.replace(/(\d)[\s\u00a0\u202f.,](?=\d{3}\b)/g, "$1");
  return new RegExp(`(^|[^\\d])${digits}([^\\d]|$)`).test(normalized);
}
