import type { QuoteMode } from "@/db/schema";
import { normalize } from "./email-rules";
import { placesIn, type Place } from "./gazetteer";

/**
 * Sales module rules: which mode an inquiry is, what was asked for and what is
 * still missing. Completeness is always decided here, never by the AI alone.
 */

export type QuoteDetails = {
  origin: string | null;
  destination: string | null;
  incoterms: string | null;
  /** Sea/rail containers: "20", "40", "40HC". */
  containerType: string | null;
  containers: number | null;
  seaType: "FCL" | "LCL" | null;
  packages: number | null;
  pallets: number | null;
  weightKg: number | null;
  volumeCbm: number | null;
  commodity: string | null;
  readyDate: string | null;
  dangerous: boolean;
  reefer: boolean;
  /** Road: requested vehicle (or derived from pallets). */
  vehicleKind: "bus" | "solo" | "tractor" | null;
};

export const EMPTY_DETAILS: QuoteDetails = {
  origin: null,
  destination: null,
  incoterms: null,
  containerType: null,
  containers: null,
  seaType: null,
  packages: null,
  pallets: null,
  weightKg: null,
  volumeCbm: null,
  commodity: null,
  readyDate: null,
  dangerous: false,
  reefer: false,
  vehicleKind: null,
};

export const MODE_LABEL: Record<QuoteMode, string> = { sea: "morski", air: "lotniczy", rail: "kolejowy", road: "drogowy" };

export function detectMode(text: string): QuoteMode {
  const t = normalize(text);
  if (/lotnicz|\bair\b|samolot|lotnisk|awb\b/.test(t)) return "air";
  // "kolejny", "kolejność" are not rail; "port" in an address is not sea freight.
  if (/\bkolej(a|ą|e|owo|owy|owa|owe|owym|owej|owego)?\b|\brail\b|pociag|nowy jedwabny/.test(t)) return "rail";
  if (/morsk|\bfcl\b|\blcl\b|kontener|\bsea\b|statk|ocean/.test(t)) return "sea";
  return "road";
}

const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

/** Rule-based reading of an inquiry (fallback for the AI). */
export function extractQuoteByRules(text: string, extraPlaces: Place[] = []): QuoteDetails {
  const t = normalize(text);
  const d: QuoteDetails = { ...EMPTY_DETAILS };
  const places = placesIn(text, extraPlaces);
  // "z Gdańska do Szanghaju" / "Gdańsk – Szanghaj": first place is the origin, second the destination.
  d.origin = places[0]?.name ?? null;
  d.destination = places[1]?.name ?? null;
  const inc = text.toUpperCase().match(new RegExp(`\\b(${INCOTERMS.join("|")})\\b`));
  d.incoterms = inc ? inc[1] : null;
  // "2 x 20'", "1x40HC" — or a single "40' HC", "40hc", "20 ft".
  const multi = t.match(/\b(\d+)\s*[x×]\s*(20|40)\s*'?\s*(hc|hq)?/);
  const single = t.match(/\b(20|40)\s*('|ft\b|dv\b|hc\b|hq\b)\s*(hc|hq)?/);
  if (multi) {
    d.containers = Number(multi[1]);
    d.containerType = multi[2] + (multi[3] ? "HC" : "");
  } else if (single) {
    d.containers = 1;
    d.containerType = single[1] + (/h[cq]/.test(single[2]) || single[3] ? "HC" : "");
  }
  if (/\blcl\b|drobnic/.test(t)) d.seaType = "LCL";
  else if (/\bfcl\b/.test(t) || d.containerType) d.seaType = "FCL";
  const kg = t.match(/\b(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?)\s*kg\b/);
  const tonnes = t.match(/\b(\d+(?:[.,]\d+)?)\s*(t|ton\w*)\b/);
  d.weightKg = kg ? Math.round(Number(kg[1].replace(/[ .](?=\d{3})/g, "").replace(",", "."))) : tonnes ? Math.round(Number(tonnes[1].replace(",", ".")) * 1000) : null;
  const cbm = t.match(/\b(\d+(?:[.,]\d+)?)\s*(cbm|m3|m³|m\^3)/);
  d.volumeCbm = cbm ? Number(cbm[1].replace(",", ".")) : null;
  const pallets = t.match(/\b(\d{1,2})\s*(palet\w*|pal\b|ep\b|europalet\w*)/);
  d.pallets = pallets ? Number(pallets[1]) : null;
  const pkgs = t.match(/\b(\d{1,4})\s*(opakowa\w*|karton\w*|skrzy\w*|colli|szt\w*|paczk\w*)/);
  d.packages = pkgs ? Number(pkgs[1]) : d.pallets;
  // A date, not a decimal weight or volume ("4.5 t", "1.6 cbm").
  const ready = t.match(/\b((?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])(?:\.\d{4})?)\b(?!\s*(?:t\b|ton|kg|cbm|m3))/);
  d.readyDate = ready ? ready[1] : /\bod zaraz|\bgotowe\b|elastyczn/.test(t) ? "elastyczny" : null;
  d.dangerous = /\badr\b|\bimo\b|\bdgr\b|niebezpieczn|un ?\d{4}/.test(t);
  d.reefer = /chlodni|temperatur|reefer|\+\s?\d+\s?°?\s?c\b/.test(t);
  const commodity = t.match(/\b(papier\w*|meble|mebl\w*|elektronik\w*|pasza|zywnosc|chemi\w*|probk\w*|probek|czesci\w*|tekstyl\w*|maszyn\w*|drobnica)\b/);
  d.commodity = commodity ? commodity[1] : null;
  if (/\bbus\b|busem|do 3,5 ?t/.test(t)) d.vehicleKind = "bus";
  else if (/solow|solo\b/.test(t)) d.vehicleKind = "solo";
  else if (/naczep|ciagnik|\bftl\b|full truck|tir\b/.test(t)) d.vehicleKind = "tractor";
  return d;
}

/**
 * Free-text fields read by AI go into messages to agents, so they are narrowed
 * to safe values: places must be known (built-in list or the client's points),
 * the date must look like a date, the goods description is short plain text.
 */
export function normalizeDetails(d: QuoteDetails, knownPlaces: Place[]): QuoteDetails {
  const place = (v: string | null) => (v ? (placesIn(v, knownPlaces)[0]?.name ?? null) : null);
  const date = (v: string | null) =>
    v && /^(\d{1,2}\.\d{1,2}(\.\d{2,4})?|\d{4}-\d{2}-\d{2}|elastyczny|od zaraz|jak najszybciej)$/i.test(v.trim()) ? v.trim() : null;
  const commodity = d.commodity
    ? d.commodity
        .replace(/[^\p{L}\p{N} ,.-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40) || null
    : null;
  return { ...d, origin: place(d.origin), destination: place(d.destination), readyDate: date(d.readyDate), commodity };
}

/** Vehicle for a road quote: explicit request, otherwise the smallest one the pallets fit in. */
export function roadVehicleFor(d: QuoteDetails): "bus" | "solo" | "tractor" | null {
  if (d.vehicleKind) return d.vehicleKind;
  const pallets = d.pallets ?? d.packages;
  if (pallets !== null) return pallets <= 8 && (d.weightKg ?? 0) <= 1200 ? "bus" : pallets <= 18 && (d.weightKg ?? 0) <= 9000 ? "solo" : "tractor";
  if (d.weightKg !== null) return d.weightKg <= 1200 ? "bus" : d.weightKg <= 9000 ? "solo" : "tractor";
  return null;
}

/** Missing required data per mode (spec: Sales §1 table). */
export function missingFor(mode: QuoteMode, d: QuoteDetails): string[] {
  const m: string[] = [];
  const need = (ok: unknown, label: string) => {
    if (ok === null || ok === undefined || ok === "") m.push(label);
  };
  need(d.origin, "miejsce nadania");
  need(d.destination, "miejsce przeznaczenia");
  if (mode !== "road") need(d.incoterms, "incoterms");
  need(d.weightKg, "waga");
  if (mode === "road") {
    need(d.pallets ?? d.packages ?? d.vehicleKind, "liczba palet lub typ pojazdu");
    need(d.readyDate, "termin");
    return m;
  }
  need(d.readyDate, "data gotowości towaru");
  need(d.commodity, "rodzaj towaru");
  if (mode === "sea" && d.seaType !== "LCL") {
    need(d.containerType, "typ kontenera");
  } else if (mode === "rail") {
    need(d.containerType, "typ kontenera");
  } else {
    need(d.packages, "liczba opakowań");
    need(d.volumeCbm, mode === "air" ? "wymiary lub objętość (CBM)" : "objętość (CBM)");
  }
  return m;
}

/** Air freight: the greater of actual weight and volume weight (1 CBM = 167 kg). */
export function chargeableWeightKg(d: Pick<QuoteDetails, "weightKg" | "volumeCbm">): number | null {
  if (d.weightKg === null && d.volumeCbm === null) return null;
  return Math.max(d.weightKg ?? 0, Math.round((d.volumeCbm ?? 0) * 167));
}

/** What the agent is asked to price, without anything identifying the client. */
export function rfqSummary(mode: QuoteMode, d: QuoteDetails): string {
  const parts = [
    `Tryb: ${MODE_LABEL[mode]}${d.seaType && mode === "sea" ? ` ${d.seaType}` : ""}`,
    `Trasa: ${d.origin ?? "?"} → ${d.destination ?? "?"}`,
    d.incoterms ? `Incoterms: ${d.incoterms}` : null,
    d.containerType ? `Kontenery: ${d.containers ?? 1} × ${d.containerType}'` : null,
    d.packages ? `Opakowania: ${d.packages}` : null,
    d.weightKg ? `Waga: ${d.weightKg.toLocaleString("pl-PL")} kg` : null,
    d.volumeCbm ? `Objętość: ${d.volumeCbm} CBM` : null,
    mode === "air" && chargeableWeightKg(d) ? `Waga płatna: ${chargeableWeightKg(d)!.toLocaleString("pl-PL")} kg` : null,
    d.commodity ? `Towar: ${d.commodity}` : null,
    d.dangerous ? "Towar niebezpieczny: tak" : null,
    d.reefer ? "Kontrola temperatury: tak" : null,
    d.readyDate ? `Gotowość: ${d.readyDate}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}
