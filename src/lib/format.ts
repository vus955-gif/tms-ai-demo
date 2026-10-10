import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

export const WARSAW = "Europe/Warsaw";

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));

/** Formats a timestamp in Warsaw time with a date-fns pattern, Polish locale. */
export function formatWarsaw(value: Date | string | number, pattern: string): string {
  return format(new TZDate(toDate(value).getTime(), WARSAW), pattern, { locale: pl });
}

const WEEKDAY_SHORT = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

/** "wt 14.10 · 10:42" */
export function formatSimClock(value: Date | string | number): string {
  const local = new TZDate(toDate(value).getTime(), WARSAW);
  return `${WEEKDAY_SHORT[local.getDay()]} ${format(local, "d.MM · HH:mm", { locale: pl })}`;
}

/** "10:42" */
export const formatTime = (value: Date | string | number) => formatWarsaw(value, "HH:mm");

/** Minutes as "4:15" (hours:minutes). Negative values are clamped to 0:00. */
export function formatHm(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function formatUsd(value: number): string {
  if (value === 0) return "0 USD";
  if (value < 0.01) return `${(value * 100).toFixed(3).replace(".", ",")} ¢`;
  return `${value.toFixed(2).replace(".", ",")} USD`;
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat("pl-PL").format(Math.round(value));
}
