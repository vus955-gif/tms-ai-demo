import type { QuoteMode } from "@/db/schema";
import { chargeableWeightKg, type QuoteDetails } from "@/domain/quote-rules";
import { groupThousands } from "@/domain/sales-pricing";
import type { Rng } from "../random";

/**
 * Freight agent reply bots for the demo. Price levels are FICTIONAL and only
 * keep the numbers plausible relative to each other — not a market quotation.
 */

export type AgentRate = { price: number; currency: string; transitDays: number; validDays: number; conditions: string };

const ASIA = ["CN", "HK", "KR", "SG", "JP", "IN", "AE"];

function seaRate(d: QuoteDetails, rng: Rng, toAsia: boolean): AgentRate {
  if (d.seaType === "LCL") {
    const perCbm = toAsia ? rng.int(45, 75) : rng.int(70, 120);
    return { price: Math.max(1, Math.ceil(d.volumeCbm ?? 1)) * perCbm, currency: "USD", transitDays: rng.int(34, 45), validDays: 14, conditions: "LCL W/M, min. 1 CBM; THC po stronie odbiorcy" };
  }
  const per40 = toAsia ? rng.int(600, 1250) : rng.int(1800, 3200);
  const unit = d.containerType?.startsWith("20") ? Math.round(per40 * 0.62) : d.containerType === "40HC" ? per40 + 60 : per40;
  return { price: unit * (d.containers ?? 1), currency: "USD", transitDays: rng.int(28, 40), validDays: 14, conditions: "BAF w cenie, THC w porcie przeznaczenia po stronie odbiorcy, 14 dni free time" };
}

function airRate(d: QuoteDetails, rng: Rng): AgentRate {
  const kg = chargeableWeightKg(d) ?? 100;
  const perKg = rng.int(210, 380) / 100;
  return { price: Math.max(150, Math.round(kg * perKg)), currency: "EUR", transitDays: rng.int(2, 5), validDays: 7, conditions: `waga płatna ${groupThousands(kg)} kg, w tym FSC/SSC; odprawa celna niewliczona` };
}

function railRate(d: QuoteDetails, rng: Rng): AgentRate {
  const per40 = rng.int(4000, 6500);
  const unit = d.containerType?.startsWith("20") ? Math.round(per40 * 0.7) : per40;
  return { price: unit * (d.containers ?? 1), currency: "USD", transitDays: rng.int(16, 24), validDays: 10, conditions: "terminal–terminal (Małaszewicze), przeładunek na granicy w cenie" };
}

export function agentRate(mode: QuoteMode, d: QuoteDetails, destinationCountry: string | null, priceFactor: number, rng: Rng): AgentRate {
  const base = mode === "air" ? airRate(d, rng) : mode === "rail" ? railRate(d, rng) : seaRate(d, rng, destinationCountry !== null && ASIA.includes(destinationCountry));
  return { ...base, price: Math.round(base.price * priceFactor) };
}

const dateIn = (from: Date, days: number) => {
  const d = new Date(from.getTime() + days * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
};

export function agentReplyText(opts: { language: "pl" | "en"; number: string; route: string; rate: AgentRate; contactName: string; now: Date }): string {
  const { rate } = opts;
  const amount = groupThousands(rate.price);
  if (opts.language === "en") {
    return `Hello,\n\nre your RFQ ${opts.number} (${opts.route}):\nRate: ${rate.currency} ${amount} all-in, valid until ${dateIn(opts.now, rate.validDays)}.\nTransit time approx. ${rate.transitDays} days.\nRemarks: ${rate.conditions}. Subject to space and equipment availability.\n\nBest regards,\n${opts.contactName}`;
  }
  return `Dzień dobry,\n\nw odpowiedzi na zapytanie ${opts.number} (${opts.route}):\nStawka: ${amount} ${rate.currency}, ważna do ${dateIn(opts.now, rate.validDays)}.\nCzas tranzytu ok. ${rate.transitDays} dni.\nUwagi: ${rate.conditions}.\n\nPozdrawiam\n${opts.contactName}`;
}

export function noSpaceText(language: "pl" | "en", number: string, contactName: string): string {
  return language === "en"
    ? `Hello,\n\nunfortunately we cannot offer space for ${number} on the requested dates. We will come back if the situation changes.\n\nBest regards,\n${contactName}`
    : `Dzień dobry,\n\nniestety na ten termin nie mamy miejsca dla zapytania ${number}. Odezwiemy się, jeśli coś się zwolni.\n\nPozdrawiam\n${contactName}`;
}

/** Reply to a negotiation: accept the target or meet halfway. */
export function negotiationReplyText(opts: { language: "pl" | "en"; number: string; accepted: boolean; price: number; currency: string; contactName: string }): string {
  const amount = groupThousands(opts.price);
  if (opts.language === "en") {
    return opts.accepted
      ? `Hello,\n\nfor ${opts.number} we can accept ${opts.currency} ${amount} all-in. Please confirm booking.\n\nBest regards,\n${opts.contactName}`
      : `Hello,\n\nfor ${opts.number} the best we can do is ${opts.currency} ${amount} all-in.\n\nBest regards,\n${opts.contactName}`;
  }
  return opts.accepted
    ? `Dzień dobry,\n\ndla ${opts.number} akceptujemy ${amount} ${opts.currency}. Prosimy o potwierdzenie rezerwacji.\n\nPozdrawiam\n${opts.contactName}`
    : `Dzień dobry,\n\ndla ${opts.number} możemy zejść najwyżej do ${amount} ${opts.currency}.\n\nPozdrawiam\n${opts.contactName}`;
}
