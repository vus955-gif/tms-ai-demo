import { TZDate } from "@date-fns/tz";
import { normalize } from "./email-rules";
import type { MilestoneKind, ShipmentMode } from "./shipments";

/**
 * Texts around sea/air/rail shipments: the status request to an agent (template),
 * reading the agent's answer by rules (fallback for AI), the client update template
 * and the guard that keeps agent names and money out of client mail.
 */

const WARSAW = "Europe/Warsaw";
const pad = (n: number) => String(n).padStart(2, "0");

/** "21.10.2026 14:30" in Warsaw time — the format agents and our bots use. */
export function formatShipmentDate(ms: number): string {
  const d = new TZDate(ms, WARSAW);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * An ISO date-time as a timestamp. Without a zone ("2026-10-21T08:00") it is Warsaw time —
 * the zone of the whole simulation — not the server's zone (UTC on Vercel). NaN if unreadable.
 */
export function parseShipmentTime(value: string): number {
  const v = value.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) return Date.parse(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (!m) return NaN;
  return new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), WARSAW).getTime();
}

export type ShipmentRefs = Record<string, string>;

const REF_LABEL: Record<string, string> = {
  booking: "Booking",
  bl: "B/L",
  awb: "AWB",
  container: "Kontener",
  vessel: "Statek / rejs",
  flight: "Lot",
  train: "Pociąg",
  clientRef: "Ref. klienta",
};

const REF_LABEL_EN: Record<string, string> = {
  booking: "Booking",
  bl: "B/L",
  awb: "AWB",
  container: "Container",
  vessel: "Vessel / voyage",
  flight: "Flight",
  train: "Train",
};

/** Numbers safe to show the agent and the client (the client's own reference only to the client). */
export function refsText(refs: ShipmentRefs, opts: { forClient: boolean; language?: "pl" | "en" }): string {
  const labels = opts.language === "en" ? REF_LABEL_EN : REF_LABEL;
  return Object.entries(refs)
    .filter(([k, v]) => v && labels[k] && (opts.forClient || k !== "clientRef"))
    .map(([k, v]) => `${labels[k]}: ${v}`)
    .join("\n");
}

/** Status request to the agent: shipment numbers only — no client data, no prices. */
export function agentStatusRequest(input: { number: string; mode: ShipmentMode; route: string; refs: ShipmentRefs; language: "pl" | "en"; signature: string; reminder?: boolean }) {
  const refs = refsText(input.refs, { forClient: false, language: input.language });
  if (input.language === "en") {
    return {
      subject: `${input.reminder ? "Reminder: " : ""}Status request ${input.number}`,
      body: `Hello,\n\n${input.reminder ? "a friendly reminder — " : ""}could you please send the current status of our shipment ${input.number} (${input.route})?\n${refs}\n\nWe need: actual departure/arrival dates, the current ETA and any delays.\n\nBest regards\n${input.signature}`,
    };
  }
  return {
    subject: `${input.reminder ? "Przypomnienie: " : ""}Prośba o status ${input.number}`,
    body: `Dzień dobry,\n\n${input.reminder ? "uprzejmie przypominamy — " : ""}prosimy o aktualny status przesyłki ${input.number} (${input.route}).\n${refs}\n\nPotrzebujemy: rzeczywiste daty wyjazdu/przyjazdu, aktualne ETA i ewentualne opóźnienia.\n\nPozdrawiam\n${input.signature}`,
  };
}

export type StatusEvent = { kind: Exclude<MilestoneKind, "booking">; atMs: number };
export type StatusReading = { events: StatusEvent[]; etaMs: number | null; delayReason: string | null; confidence: number };

const KEYWORDS: [StatusEvent["kind"], RegExp][] = [
  ["terminal_in", /(przyjet\w*\s+w\s+terminalu|received at)/],
  ["departed", /(wyplyn\w*|odlot|odjazd|departed|\batd\b)/],
  ["transshipment", /(przeladun\w*|transshipment)/],
  ["border", /(przejscie graniczne|border crossing)/],
  ["arrived", /(przyby\w*|przylecial\w*|przylot|przyjazd|\bata\b|arrived)/],
  ["customs", /(odprawa celna zakonczona|customs cleared)/],
  ["delivered", /(dostarczon\w*|delivered)/],
];

const DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(?:godz\.?\s*)?(\d{1,2}):(\d{2}))?/;

function parseDateAt(text: string, from: number): { ms: number; end: number } | null {
  const window = text.slice(from, from + 80);
  const m = DATE_RE.exec(window);
  if (!m) return null;
  const [d, mo, y, h, mi] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 12), Number(m[5] ?? 0)];
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { ms: new TZDate(y, mo, d, h, mi, WARSAW).getTime(), end: from + m.index + m[0].length };
}

/** Reads dates of events, the ETA and a delay reason from an agent's free text (Polish or English). */
export function readStatusByRules(text: string): StatusReading {
  const norm = normalize(text);
  const events: StatusEvent[] = [];
  for (const [kind, re] of KEYWORDS) {
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(norm))) {
      const date = parseDateAt(norm, m.index + m[0].length);
      if (date) {
        events.push({ kind, atMs: date.ms });
        break;
      }
    }
  }
  const etaMatch = /\beta\b/.exec(norm);
  const eta = etaMatch ? parseDateAt(norm, etaMatch.index + 3) : null;
  // "Opóźnienie ok. 48 h — kongestia w porcie." / "Delay approx. 48 h — port congestion."
  const delayReason = /(?:opóźnieni\w*|opoznieni\w*|delay\w*)[^\n—–]*[—–]\s*([^.\n]{3,120})/i.exec(text)?.[1]?.trim() ?? null;
  const found = events.length > 0 || eta !== null;
  return { events, etaMs: eta?.ms ?? null, delayReason, confidence: found ? 0.6 : 0.2 };
}

export type ClientUpdateFacts = {
  number: string;
  clientRef: string | null;
  modeLabel: string;
  route: string;
  destination: string;
  refs: string;
  last: { label: string; location: string; atMs: number } | null;
  next: { label: string; location: string; plannedMs: number } | null;
  etaMs: number;
  delayHours: number;
  delayReason: string | null;
  recipientName: string | null;
  signature: string;
};

/** The deterministic client update; the AI draft must keep the same facts. */
export function clientUpdateTemplate(f: ClientUpdateFacts): { subject: string; body: string } {
  // No "Pan/Pani" guess from a name: a neutral greeting is never wrong.
  const greeting = "Dzień dobry,";
  const lines = [
    `informujemy o statusie przesyłki ${f.modeLabel} ${f.number}${f.clientRef ? ` (ref. ${f.clientRef})` : ""}, trasa ${f.route}.`,
    f.last ? `Ostatni etap: ${f.last.label} — ${f.last.location}, ${formatShipmentDate(f.last.atMs)}.` : "Przesyłka czeka na wyjazd.",
    `Przewidywane dotarcie do ${f.destination}: ${formatShipmentDate(f.etaMs)}${f.delayHours >= 12 ? ` (opóźnienie ok. ${f.delayHours < 36 ? `${f.delayHours} h` : `${Math.round(f.delayHours / 24)} dni`}${f.delayReason ? ` — ${f.delayReason}` : ""})` : ""}.`,
    f.next ? `Następny etap: ${f.next.label} — ${f.next.location}, planowo ${formatShipmentDate(f.next.plannedMs)}.` : "",
  ].filter(Boolean);
  return {
    subject: `Status przesyłki ${f.number}${f.clientRef ? ` / ${f.clientRef}` : ""}`,
    body: `${greeting}\n\n${lines.join("\n")}${f.refs ? `\n\n${f.refs}` : ""}\n\nW razie pytań pozostajemy do dyspozycji.\n\nPozdrawiam\n${f.signature}`,
  };
}

const LEGAL_FORMS = new Set(["sp", "z", "o", "oo", "sa", "s", "a", "gmbh", "ltd", "inc", "co"]);
/** Words of agent names that also name places or the trade itself ("Gdańsk Cargo Partners" vs. "port Gdańsk", "air cargo"). */
const GENERIC = new Set([
  "air", "cargo", "sea", "rail", "shipping", "logistics", "services", "service", "partners", "agency", "freight", "express", "hub", "box", "intermodal",
  "polska", "gdansk", "warsaw", "warszawa", "baltic", "north", "gulf", "middle", "silk", "multimodal", "med", "star", "fra", "and",
]);

/**
 * Agent company, person or address, or any money amount, must not reach the client.
 * Like the client guard (client-leak.ts): two consecutive words of the company name,
 * or its distinctive first word — a single word that is also a place is not a leak.
 */
export function leaksAgentData(text: string, agentsList: { company: string; contactName: string; email: string }[]): boolean {
  const norm = normalize(text);
  const flat = ` ${norm.split(/[^a-z0-9]+/).filter(Boolean).join(" ")} `;
  const words = new Set(flat.trim().split(" "));
  for (const a of agentsList) {
    const name = normalize(a.company)
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !LEGAL_FORMS.has(w));
    const bigrams = name
      .slice(1)
      .map((w, i) => [name[i], w])
      .filter(([x, y]) => !(GENERIC.has(x) && GENERIC.has(y)))
      .map(([x, y]) => `${x} ${y}`);
    if (bigrams.some((b) => flat.includes(` ${b} `))) return true;
    // Names made of generic words only ("Gdańsk Cargo Partners", "Warsaw Air Cargo Services"): three words in a row, or the whole name.
    const phrases = name.length >= 3 ? name.slice(2).map((w, i) => `${name[i]} ${name[i + 1]} ${w}`) : [name.join(" ")];
    if (name.length >= 2 && phrases.some((p) => flat.includes(` ${p} `))) return true;
    const first = name[0];
    if (first && first.length >= 4 && !GENERIC.has(first) && words.has(first)) return true;
    // Surnames inflect in Polish ("Nowicka" → "od pani Nowickiej"): longer ones match by their stem.
    const surname = normalize(a.contactName).split(/\s+/).at(-1) ?? "";
    const stem = surname.length >= 6 ? surname.slice(0, -1) : null;
    if (surname.length >= 4 && (words.has(surname) || (stem !== null && [...words].some((w) => w.startsWith(stem))))) return true;
    const domain = normalize(a.email.split("@")[1] ?? "");
    if (norm.includes(normalize(a.email)) || (domain && norm.includes(domain))) return true;
  }
  return MONEY.some((re) => re.test(norm));
}

/**
 * Money in any usual form (on normalised text, so "zł" is "zl"): "450 EUR", "450 zł", "450 euro",
 * "1 200 złotych", "EUR 450", "€450", "$1200". "33 EUR-palety" (pallet type) is not money.
 */
const MONEY = [
  /\d[\d\s.,]*\s*(pln|zl|zlot\w*|eur|euro|usd|dolar\w*|€|\$)(?![a-z-])/,
  /\b(pln|zl|eur|euro|usd)\s*\d/,
  /(€|\$)\s*\d/,
];
