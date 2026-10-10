import { formatTime } from "@/lib/format";
import { beginNextLeg, predictArrival, type SimEnv, type SimState, type Stop } from "@/simulation/vehicle-sim";

/**
 * "Klocki": which driver fits a new order (spec §7.4). Hard filters first
 * (capacity, body, ADR, reaching the windows under driving-time rules), then a
 * transparent score with reasons in plain Polish. Drivers are never rated as
 * people — only their fit for this one order.
 */

export type MatchOrder = {
  id: string;
  clientId: string;
  pickupPointId: string;
  deliveryPointId: string;
  pickupFromMs: number;
  pickupToMs: number;
  deliveryFromMs: number;
  deliveryToMs: number;
  cargoPallets: number;
  cargoKg: number;
  bodyRequired: "plandeka" | "chlodnia" | "skrzynia" | null;
  adrRequired: boolean;
  pickupHandlingMin: number;
  deliveryHandlingMin: number;
};

export type MatchCandidate = {
  vehicleId: string;
  driverId: string;
  capacityPallets: number;
  capacityKg: number;
  body: "plandeka" | "chlodnia" | "skrzynia" | null;
  adr: boolean;
  driverAdr: boolean;
  /** State at "now" including already confirmed stops. */
  sim: SimState;
  env: SimEnv;
  /** Where the vehicle will be free: last queued stop or where it stands. */
  freePointId: string | null;
  historyWithClient: number;
  /** Road distance between two points in metres. */
  distanceM: (from: string, to: string) => number;
};

export type MatchTier = "high" | "medium" | "low" | "excluded";
export type MatchResult = {
  vehicleId: string;
  driverId: string;
  tier: MatchTier;
  score: number;
  reasons: string[];
  pickupEtaMs: number | null;
  emptyKm: number | null;
};

const TIER_RANK: Record<MatchTier, number> = { high: 0, medium: 1, low: 2, excluded: 3 };

function excluded(c: MatchCandidate, reason: string): MatchResult {
  return { vehicleId: c.vehicleId, driverId: c.driverId, tier: "excluded", score: 0, reasons: [reason], pickupEtaMs: null, emptyKm: null };
}

export function evaluateCandidate(order: MatchOrder, c: MatchCandidate): MatchResult {
  if (order.cargoPallets > c.capacityPallets) return excluded(c, `za mała pojemność: ${order.cargoPallets} palet (mieści ${c.capacityPallets})`);
  if (order.cargoKg > c.capacityKg) return excluded(c, `za mała ładowność: ${(order.cargoKg / 1000).toFixed(1).replace(".", ",")} t`);
  if (order.bodyRequired === "chlodnia" && c.body !== "chlodnia") return excluded(c, "wymagana chłodnia");
  if (order.adrRequired && !c.adr) return excluded(c, "pojazd bez wyposażenia ADR");
  if (order.adrRequired && !c.driverAdr) return excluded(c, "kierowca bez zaświadczenia ADR");

  const stops: Stop[] = [
    ...c.sim.stops,
    {
      orderId: order.id,
      purpose: "pickup",
      pointId: order.pickupPointId,
      windowFromMs: order.pickupFromMs,
      windowToMs: order.pickupToMs,
      handlingMin: order.pickupHandlingMin,
    },
    {
      orderId: order.id,
      purpose: "delivery",
      pointId: order.deliveryPointId,
      windowFromMs: order.deliveryFromMs,
      windowToMs: order.deliveryToMs,
      handlingMin: order.deliveryHandlingMin,
    },
  ];
  const sim = beginNextLeg({ ...c.sim, stops }, c.env.routeKeyBetween);
  const pickup = predictArrival(sim, c.env, (s) => s.orderId === order.id && s.purpose === "pickup");
  if (!pickup || pickup.arrivalMs > order.pickupToMs) {
    return excluded(c, pickup ? `nie zdąży na załadunek (ETA ${formatTime(pickup.arrivalMs)}, okno do ${formatTime(order.pickupToMs)})` : "nie zdąży na załadunek");
  }
  const delivery = predictArrival(sim, c.env, (s) => s.orderId === order.id && s.purpose === "delivery");
  if (!delivery || delivery.arrivalMs > order.deliveryToMs) {
    return excluded(c, delivery ? `nie zdąży na rozładunek (ETA ${formatTime(delivery.arrivalMs)}, okno do ${formatTime(order.deliveryToMs)})` : "nie zdąży na rozładunek");
  }

  const reasons: string[] = [];
  let score = 100;
  const emptyKm = c.freePointId ? Math.round(c.distanceM(c.freePointId, order.pickupPointId) / 1000) : null;
  if (emptyKm !== null) {
    score -= Math.min(emptyKm / 4, 50);
    reasons.push(emptyKm === 0 ? "stoi na miejscu załadunku" : `${emptyKm} km od załadunku`);
  }
  const idle = c.sim.stops.length === 0;
  reasons.push(idle ? "wolny teraz" : "po bieżącym zleceniu");
  const slackMin = (order.pickupToMs - pickup.arrivalMs) / 60_000;
  score += Math.min(slackMin / 15, 10);
  reasons.push(`załadunek ok. ${formatTime(Math.max(pickup.arrivalMs, order.pickupFromMs))}`);
  if (c.historyWithClient > 0) {
    score += Math.min(c.historyWithClient, 6) * 4;
    reasons.push(`był u klienta ${c.historyWithClient} ${c.historyWithClient === 1 ? "raz" : "razy"}`);
  }
  if (delivery.restRequired) {
    score -= 20;
    reasons.push("po drodze potrzebny odpoczynek dobowy");
  }
  if (order.bodyRequired !== "chlodnia" && c.body === "chlodnia") {
    score -= 10;
    reasons.push("chłodnia na towar suchy");
  }
  // A much bigger vehicle than needed ranks a little lower (no reason shown: it is rarely decisive).
  if (c.capacityPallets - order.cargoPallets >= 15) score -= 5;
  const tier: MatchTier = score >= 85 ? "high" : score >= 60 ? "medium" : "low";
  return { vehicleId: c.vehicleId, driverId: c.driverId, tier, score: Math.round(score), reasons, pickupEtaMs: pickup.arrivalMs, emptyKm };
}

export function matchCandidates(order: MatchOrder, candidates: MatchCandidate[]): MatchResult[] {
  return candidates
    .map((c) => evaluateCandidate(order, c))
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score);
}
