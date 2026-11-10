import { formatSimClock, formatTime, formatWarsaw } from "@/lib/format";
import { SMS_TEXT, type DriverLanguage } from "./driver-language";

/**
 * SMS texts sent to drivers. Built from order data only — addresses, times and
 * references are copied verbatim; AI never writes these (spec §2, §7).
 * In another language only the fixed words change (ready-made translations); the data stays as it is.
 */

type PointInfo = { name: string; address: string; city: string; country: string; requirements: string; notes: string };
type OrderInfo = {
  number: string;
  pickupFrom: Date;
  pickupTo: Date;
  deliveryFrom: Date;
  deliveryTo: Date;
  cargoPallets: number;
  cargoKg: number;
  bodyRequired: string | null;
  adrRequired: boolean;
  references: string[];
  notes: string;
};

/** "śr 15.10 07:00–09:00" (or both dates when the window spans midnight). */
export function windowText(from: Date, to: Date): string {
  const sameDay = formatSimClock(from).slice(0, -8) === formatSimClock(to).slice(0, -8);
  return sameDay ? `${formatSimClock(from).replace(" · ", " ")}–${formatTime(to)}` : `${formatSimClock(from).replace(" · ", " ")} – ${formatSimClock(to).replace(" · ", " ")}`;
}

/** The same window without the Polish weekday abbreviation: "15.10 07:00–09:00". */
function windowNumeric(from: Date, to: Date): string {
  const day = (d: Date) => formatWarsaw(d, "d.MM");
  return day(from) === day(to) ? `${day(from)} ${formatTime(from)}–${formatTime(to)}` : `${day(from)} ${formatTime(from)} – ${day(to)} ${formatTime(to)}`;
}

/** A time window as the driver reads it: with the Polish weekday for Polish, numeric otherwise. */
export const windowFor = (lang: DriverLanguage, from: Date, to: Date) => (lang === "pl" ? windowText(from, to) : windowNumeric(from, to));
const momentFor = (lang: DriverLanguage, at: Date) => (lang === "pl" ? formatSimClock(at).replace(" · ", " ") : `${formatWarsaw(at, "d.MM")} ${formatTime(at)}`);

function pointLines(p: PointInfo, lang: DriverLanguage): string[] {
  const lines = [`${p.name}, ${p.address}, ${p.city} (${p.country})`];
  const remarks = [p.requirements, p.notes].filter(Boolean).join(". ");
  if (remarks) lines.push(`${SMS_TEXT[lang].remarks}: ${remarks}`);
  return lines;
}

/** `link`: the driver's page for this order (details, one-tap confirmation, CMR photo). Replying "OK" still works. */
export function orderSms(order: OrderInfo, clientName: string, pickup: PointInfo, delivery: PointInfo, link?: string, lang: DriverLanguage = "pl"): string {
  const t = SMS_TEXT[lang];
  const cargo = [`${order.cargoPallets} ${t.pallets}`, `${order.cargoKg} ${t.kg}`];
  if (order.bodyRequired === "chlodnia") cargo.push(t.reefer);
  if (order.adrRequired) cargo.push("ADR");
  return [
    `${t.order} ${order.number} · ${clientName}`,
    `${t.pickup}: ${windowFor(lang, order.pickupFrom, order.pickupTo)}`,
    ...pointLines(pickup, lang),
    `${t.delivery}: ${windowFor(lang, order.deliveryFrom, order.deliveryTo)}`,
    ...pointLines(delivery, lang),
    `${t.cargo}: ${cargo.join(", ")}`,
    ...(order.references.length ? [`Ref: ${order.references.join(", ")}`] : []),
    ...(order.notes ? [`${t.orderNotes}: ${order.notes}`] : []),
    ...(link ? [`${t.link}: ${link}`] : []),
    t.confirm,
  ].join("\n");
}

export function reminderSms(order: Pick<OrderInfo, "number" | "pickupFrom">, lang: DriverLanguage = "pl"): string {
  return SMS_TEXT[lang].reminder(order.number, momentFor(lang, order.pickupFrom));
}

export function cancellationSms(order: Pick<OrderInfo, "number">, lang: DriverLanguage = "pl"): string {
  return SMS_TEXT[lang].cancellation(order.number);
}

export function cmrResendSms(lang: DriverLanguage = "pl"): string {
  return SMS_TEXT[lang].cmrResend;
}

export function cmrMissingSms(order: Pick<OrderInfo, "number">, lang: DriverLanguage = "pl"): string {
  return SMS_TEXT[lang].cmrMissing(order.number);
}
