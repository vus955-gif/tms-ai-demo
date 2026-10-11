import { TZDate } from "@date-fns/tz";

/**
 * Rule-based fallback for client e-mails (used when AI is off or fails).
 * Deliberately simple: it catches the common, well-structured cases and
 * leaves everything else to the dispatcher via `missing_fields`.
 */

export const EMAIL_CATEGORIES = ["zamowienie_transportu", "zapytanie_o_status", "reklamacja", "zapytanie_ofertowe", "inne"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];
export type EmailPriority = "wysoki" | "normalny" | "niski";

export type RulePoint = { id: string; name: string; city: string };

export type ExtractedOrder = {
  pickup_point_id: string | null;
  delivery_point_id: string | null;
  pickup_from: string | null;
  pickup_to: string | null;
  delivery_from: string | null;
  delivery_to: string | null;
  pallets: number | null;
  kg: number | null;
  reefer: boolean;
  adr: boolean;
  references: string[];
  notes: string | null;
  missing_fields: string[];
};

const WARSAW = "Europe/Warsaw";

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const SUMMARY: Record<EmailCategory, string> = {
  zamowienie_transportu: "Klient zamawia transport.",
  zapytanie_o_status: "Klient pyta, gdzie jest auto i kiedy dojedzie.",
  reklamacja: "Klient zgłasza reklamację.",
  zapytanie_ofertowe: "Klient prosi o wycenę.",
  inne: "Sprawa ogólna — przeczytaj mail.",
};

export function categorizeEmail(subject: string, body: string): { category: EmailCategory; priority: EmailPriority; summary: string } {
  const t = normalize(`${subject}\n${body}`);
  let category: EmailCategory = "inne";
  if (/reklamac|uszkodz|zniszcz|brak\w* (towaru|palet|sztuk|kartonow)|szkod[ay]|skarg|niezadowol/.test(t)) category = "reklamacja";
  else if (/wycen|ofert|stawk|cennik|ile (by )?kosztow|\bfcl\b|\blcl\b|kontener|incoterms|\b(fob|cif|exw|dap)\b|lotnicz|morsk|kolejow/.test(t)) category = "zapytanie_ofertowe";
  else if (/(prosimy|prosze|zlecamy|zamawiamy|potrzebujemy)[^.]{0,40}(transport|odbior|auta|auto|samochod|przewoz)|zlecenie transport|\bzaladunek\b[\s\S]*\brozladunek\b/.test(t)) category = "zamowienie_transportu";
  else if (/gdzie jest|kiedy (bedzie|dojedzie|dotrze|przyjedzie)|\bstatus\b|\beta\b|o ktorej|na jakim etapie/.test(t)) category = "zapytanie_o_status";
  const priority: EmailPriority = category === "reklamacja" ? "wysoki" : category === "inne" ? "niski" : "normalny";
  return { category, priority, summary: SUMMARY[category] };
}

export function findRelatedOrder(text: string, orders: { id: string; number: string; references: string[] }[]): string | null {
  const compact = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "");
  const t = compact(text);
  for (const o of orders) {
    if (t.includes(compact(o.number))) return o.id;
    if (o.references.some((r) => compact(r).length >= 4 && t.includes(compact(r)))) return o.id;
  }
  return null;
}

// ——— order extraction ———

const ALIASES: Record<string, string[]> = {
  leipzig: ["lipsk"],
  praha: ["praga"],
  dresden: ["drezno"],
  grossbeeren: [],
  berlin: [],
};

/** Consonant skeleton: survives Polish declension (Gądki/Gądek, Poznań/Poznania, Lipsk/Lipska). */
const skeleton = (word: string) => normalize(word).replace(/[^a-z]/g, "").replace(/[aeiouy]/g, "");

function cityNames(p: RulePoint): string[] {
  const city = normalize(p.city);
  const extra = (p.name.split("—")[1] ?? "")
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length >= 3 && !["magazyn", "odbiorca", "salon", "fabryka", "centrum", "terminal"].includes(w));
  return [city, ...(ALIASES[city] ?? []), ...extra];
}

function pointMentioned(segment: string, p: RulePoint): boolean {
  const norm = normalize(segment);
  const words = new Set(norm.split(/[^a-z0-9]+/).filter(Boolean).map(skeleton));
  return cityNames(p).some((name) => {
    if (norm.includes(name)) return true;
    const first = name.split(/\s+/)[0];
    const sk = skeleton(first);
    return sk.length >= 3 && words.has(sk);
  });
}

function findPoint(segment: string, points: RulePoint[], exclude?: string | null): string | null {
  // Earliest mention wins when a segment names several places.
  let best: { id: string; at: number } | null = null;
  for (const p of points) {
    if (p.id === exclude || !pointMentioned(segment, p)) continue;
    const norm = normalize(segment);
    const at = Math.min(...cityNames(p).map((n) => (norm.indexOf(n) >= 0 ? norm.indexOf(n) : Number.MAX_SAFE_INTEGER)));
    if (!best || at < best.at) best = { id: p.id, at };
  }
  return best?.id ?? null;
}

type Day = { y: number; m: number; d: number };

function dayIn(segment: string, simNow: Date): Day | null {
  const t = normalize(segment);
  const local = new TZDate(simNow.getTime(), WARSAW);
  const shift = (days: number): Day => {
    const x = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + days, 12, 0, WARSAW);
    return { y: x.getFullYear(), m: x.getMonth(), d: x.getDate() };
  };
  if (/\bpojutrze\b/.test(t)) return shift(2);
  if (/\bjutro\b/.test(t)) return shift(1);
  if (/\b(dzis|dzisiaj)\b/.test(t)) return shift(0);
  const m = t.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/);
  if (m) {
    const month = Number(m[2]) - 1;
    const year = m[3] ? Number(m[3]) : local.getFullYear();
    return { y: year, m: month, d: Number(m[1]) };
  }
  return null;
}

function windowIn(segment: string): { from: [number, number]; to: [number, number] } | null {
  const t = normalize(segment).replace(/\b\d{1,2}\.\d{1,2}(\.\d{4})?\b/g, " ");
  const m = t.match(/(?:\bod\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|\bdo\b)\s*(\d{1,2})(?::(\d{2}))?\b/);
  if (!m) return null;
  const from: [number, number] = [Number(m[1]), Number(m[2] ?? 0)];
  const to: [number, number] = [Number(m[3]), Number(m[4] ?? 0)];
  if (from[0] > 23 || to[0] > 24 || from[1] > 59 || to[1] > 59) return null;
  return { from, to };
}

const at = (day: Day, [h, min]: [number, number], plusDays = 0) => new Date(new TZDate(day.y, day.m, day.d + plusDays, h, min, WARSAW).getTime()).toISOString();

function segments(text: string): { pickup: string; delivery: string } {
  const t = normalize(text);
  const pick = t.search(/\b(zaladun\w*|odbior)\b/);
  const del = t.search(/\b(rozladun\w*|dostaw\w*|odbiorc\w*)\b/);
  if (pick < 0 || del < 0) return { pickup: text, delivery: text };
  // Normalised and original text have the same length only without "ß"; slice the normalised copy.
  return pick < del ? { pickup: t.slice(pick, del), delivery: t.slice(del) } : { pickup: t.slice(pick), delivery: t.slice(del, pick) };
}

export function extractOrderByRules(text: string, points: RulePoint[], simNow: Date): ExtractedOrder {
  const { pickup, delivery } = segments(text);
  const norm = normalize(text);
  const pickupPoint = findPoint(pickup, points);
  const deliveryPoint = findPoint(delivery, points, pickupPoint);

  const anyDay = dayIn(text, simNow);
  const pickupDay = dayIn(pickup, simNow) ?? anyDay;
  const deliveryDay = dayIn(delivery, simNow) ?? pickupDay;
  const pw = windowIn(pickup);
  const dw = pickup === delivery ? null : windowIn(delivery);
  const pickupFrom = pickupDay && pw ? at(pickupDay, pw.from) : null;
  const pickupTo = pickupDay && pw ? at(pickupDay, pw.to) : null;
  let deliveryFrom = deliveryDay && dw ? at(deliveryDay, dw.from) : null;
  let deliveryTo = deliveryDay && dw ? at(deliveryDay, dw.to) : null;
  if (deliveryFrom && pickupFrom && deliveryFrom < pickupFrom && deliveryDay && dw && !dayIn(delivery, simNow)) {
    deliveryFrom = at(deliveryDay, dw.from, 1);
    deliveryTo = at(deliveryDay, dw.to, 1);
  }

  const pallets = norm.match(/\b(\d{1,2})\s*(palet\w*|pal\b|ep\b|europalet\w*|miejsc\w* paletow\w*)/);
  const kgMatch = norm.match(/\b(\d{1,3}(?:[ .]\d{3})+|\d+)\s*kg\b/);
  const tonnes = norm.match(/\b(\d+(?:[.,]\d+)?)\s*(t|ton\w*)\b/);
  const kg = kgMatch ? Number(kgMatch[1].replace(/[ .]/g, "")) : tonnes ? Math.round(Number(tonnes[1].replace(",", ".")) * 1000) : null;
  const references = [...text.matchAll(/\bref(?:erencja|erencyjny|erencje|\.)?\s*(?:nr\.?)?\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/]{2,}[A-Z0-9])/gi)].map((m) => m[1]);

  const result: ExtractedOrder = {
    pickup_point_id: pickupPoint,
    delivery_point_id: deliveryPoint,
    pickup_from: pickupFrom,
    pickup_to: pickupTo,
    delivery_from: deliveryFrom,
    delivery_to: deliveryTo,
    pallets: pallets ? Number(pallets[1]) : null,
    kg,
    reefer: /chlodni|temperatur|\+\s?\d+\s?°?\s?c\b/.test(norm),
    adr: /\badr\b/.test(norm),
    references: [...new Set(references)],
    notes: null,
    missing_fields: [],
  };
  const missing: [boolean, string][] = [
    [!result.pickup_point_id, "punkt załadunku"],
    [!result.delivery_point_id, "punkt rozładunku"],
    [!result.pickup_from, "okno załadunku"],
    [!result.delivery_from, "okno rozładunku"],
    [!result.pallets, "liczba palet"],
    [!result.kg, "waga"],
  ];
  result.missing_fields = missing.filter(([m]) => m).map(([, label]) => label);
  return result;
}
