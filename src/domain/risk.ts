import type { Prediction } from "@/simulation/vehicle-sim";

export type RiskState = "green" | "yellow" | "red" | "gray";
export type RiskReason =
  | "late_pickup"
  | "late_delivery"
  | "daily_rest_needed"
  | "break_soon"
  | "tight_buffer"
  | "no_prediction";

export type RiskInput = {
  subjectTo561: boolean;
  /** Prediction to the delivery point (full chain, incl. loading when not loaded yet). */
  delivery: Prediction | null;
  deliveryToMs: number;
  /** Present while the order has not been loaded yet. */
  pickup?: { prediction: Prediction | null; toMs: number };
};

export type RiskResult = { state: RiskState; reasons: RiskReason[]; bufferMin: number | null };

/** A break counts as "soon" when it falls within this much driving. */
export const BREAK_SOON_MIN = 60;
/** Less spare time than this before the window closes is a warning. */
export const TIGHT_BUFFER_MIN = 30;

/**
 * Traffic-light risk of one order (spec §7.3, refined — see the night report):
 * red   = late for a window, or a daily rest is needed before arrival;
 * yellow = on time, but a mandatory break is due within the next hour of
 *          driving, or less than 30 minutes to spare;
 * green = otherwise.
 */
export function evaluateRisk(input: RiskInput): RiskResult {
  const reasons: RiskReason[] = [];
  const { delivery } = input;
  if (!delivery) return { state: "red", reasons: ["no_prediction"], bufferMin: null };
  if (input.pickup) {
    const p = input.pickup.prediction;
    if (!p || p.arrivalMs > input.pickup.toMs) reasons.push("late_pickup");
  }
  const bufferMin = (input.deliveryToMs - delivery.arrivalMs) / 60_000;
  if (bufferMin < 0) reasons.push("late_delivery");
  if (input.subjectTo561 && delivery.restRequired) reasons.push("daily_rest_needed");
  if (reasons.length > 0) return { state: "red", reasons, bufferMin };

  if (input.subjectTo561 && delivery.firstBreakAfterDrivingMin !== null && delivery.firstBreakAfterDrivingMin <= BREAK_SOON_MIN) {
    reasons.push("break_soon");
  }
  if (bufferMin < TIGHT_BUFFER_MIN) reasons.push("tight_buffer");
  return { state: reasons.length > 0 ? "yellow" : "green", reasons, bufferMin };
}

export const RISK_REASON_LABEL: Record<RiskReason, string> = {
  late_pickup: "nie zdąży na załadunek w oknie",
  late_delivery: "nie zdąży na rozładunek w oknie",
  daily_rest_needed: "przed dojazdem potrzebny odpoczynek dobowy",
  break_soon: "obowiązkowa przerwa w ciągu godziny jazdy",
  tight_buffer: "mniej niż 30 min zapasu do końca okna",
  no_prediction: "brak prognozy dojazdu",
};
