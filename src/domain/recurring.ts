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

const ymd = (d: TZDate) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Warsaw calendar date (yyyy-mm-dd) of an instant, `plusDays` later. */
export function warsawDate(instant: Date, plusDays = 0): string {
  const local = new TZDate(instant.getTime(), WARSAW);
  return ymd(new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + plusDays, 12, 0, WARSAW));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The run of a template on one Warsaw date, or null when the template does not run that day. */
export function runOn(t: TemplateTimes, date: string): PlannedDay | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  // Noon avoids any ambiguity around the DST switch at night.
  const d = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, WARSAW);
  if (ymd(d) !== date || !t.weekdays.includes(isoWeekday(d))) return null;
  const [y, mo, day] = [d.getFullYear(), d.getMonth(), d.getDate()];
  return {
    date,
    pickupFrom: at(y, mo, day, t.pickupFromMin),
    pickupTo: at(y, mo, day, t.pickupToMin),
    deliveryFrom: at(y, mo, day + t.deliveryDayOffset, t.deliveryFromMin),
    deliveryTo: at(y, mo, day + t.deliveryDayOffset, t.deliveryToMin),
  };
}

/** Runs of a template in the `days` days starting the day after `now` (Warsaw calendar). */
export function plannedDays(t: TemplateTimes, now: Date, days = 7): PlannedDay[] {
  const out: PlannedDay[] = [];
  for (let i = 1; i <= days; i++) {
    const run = runOn(t, warsawDate(now, i));
    if (run) out.push(run);
  }
  return out;
}

export const WEEKDAY_SHORT = ["", "pn", "wt", "śr", "cz", "pt", "sb", "nd"];

/** Forecast for one planned order from the best fitting driver. */
export type ForecastState = "zdazy" | "ryzyko" | "brak_kierowcy";

/** Less spare time than this at loading or unloading counts as a timeliness risk. */
export const RISK_SLACK_MIN = 30;

type Best = { tier: "high" | "medium" | "low" | "excluded"; pickupEtaMs: number | null; deliveryEtaMs?: number | null };

/**
 * Timeliness, not fit: a far-away best driver who still makes the windows is
 * "zdąży" (the empty run is a cost question for "klocki"), a tight arrival is a risk.
 * For runs days ahead the truck waits for the loading window anyway, so the
 * unloading slack is what really tells.
 */
export function forecastState(best: Best | undefined, windows: { pickupToMs: number; deliveryToMs: number }): ForecastState {
  if (!best || best.tier === "excluded") return "brak_kierowcy";
  const tight = (etaMs: number | null | undefined, toMs: number) => etaMs != null && toMs - etaMs < RISK_SLACK_MIN * 60_000;
  if (tight(best.pickupEtaMs, windows.pickupToMs) || tight(best.deliveryEtaMs, windows.deliveryToMs)) return "ryzyko";
  return "zdazy";
}
