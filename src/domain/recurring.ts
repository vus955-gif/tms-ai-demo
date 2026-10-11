import { TZDate } from "@date-fns/tz";

/**
 * Recurring orders (stage 4): which days a template runs on in a planning
 * window, and the concrete windows for one day. Times are Warsaw local time.
 */

const WARSAW = "Europe/Warsaw";

export type TemplateTimes = {
  pickupFromMin: number;
  pickupToMin: number;
  deliveryDayOffset: number;
  deliveryFromMin: number;
  deliveryToMin: number;
  weekdays: number[];
};

export type PlannedDay = { date: string; pickupFrom: Date; pickupTo: Date; deliveryFrom: Date; deliveryTo: Date };

/** ISO weekday (1 = Monday … 7 = Sunday) of a Warsaw-local date. */
const isoWeekday = (d: TZDate) => ((d.getDay() + 6) % 7) + 1;

const at = (y: number, m: number, d: number, minutes: number) => new Date(new TZDate(y, m, d, Math.floor(minutes / 60), minutes % 60, WARSAW).getTime());

/** Runs of a template in the `days` days starting the day after `now` (Warsaw calendar). */
export function plannedDays(t: TemplateTimes, now: Date, days = 7): PlannedDay[] {
  const today = new TZDate(now.getTime(), WARSAW);
  const out: PlannedDay[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new TZDate(today.getFullYear(), today.getMonth(), today.getDate() + i, 12, 0, WARSAW);
    if (!t.weekdays.includes(isoWeekday(d))) continue;
    const [y, m, day] = [d.getFullYear(), d.getMonth(), d.getDate()];
    out.push({
      date: `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      pickupFrom: at(y, m, day, t.pickupFromMin),
      pickupTo: at(y, m, day, t.pickupToMin),
      deliveryFrom: at(y, m, day + t.deliveryDayOffset, t.deliveryFromMin),
      deliveryTo: at(y, m, day + t.deliveryDayOffset, t.deliveryToMin),
    });
  }
  return out;
}

export const WEEKDAY_SHORT = ["", "pn", "wt", "śr", "cz", "pt", "sb", "nd"];

/** Forecast for one planned order from the best fitting driver. */
export type ForecastState = "zdazy" | "ryzyko" | "brak_kierowcy";

/** Less spare time than this at loading counts as a timeliness risk. */
export const RISK_SLACK_MIN = 30;

/**
 * Timeliness, not fit: a far-away best driver who still makes the windows is
 * "zdąży" (the empty run is a cost question for "klocki"), a tight arrival is a risk.
 */
export function forecastState(best: { tier: "high" | "medium" | "low" | "excluded"; pickupEtaMs: number | null } | undefined, pickupToMs: number): ForecastState {
  if (!best || best.tier === "excluded") return "brak_kierowcy";
  if (best.pickupEtaMs !== null && pickupToMs - best.pickupEtaMs < RISK_SLACK_MIN * 60_000) return "ryzyko";
  return "zdazy";
}
