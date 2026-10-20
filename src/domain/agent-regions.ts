import { normalize } from "./email-rules";

/**
 * Which agents get an RFQ: those who cover the region of the foreign end of the
 * lane (or the whole world) — a forwarder asks a few relevant agents, not everyone.
 */
export type Region = "Azja" | "Bliski Wschód" | "Ameryka Płn." | "Ameryka Płd." | "Afryka" | "Europa" | "Oceania";

const COUNTRY_REGION: Record<string, Region> = {
  CN: "Azja", JP: "Azja", KR: "Azja", IN: "Azja", VN: "Azja", TH: "Azja", SG: "Azja", MY: "Azja", ID: "Azja", TW: "Azja", HK: "Azja", KZ: "Azja", PK: "Azja", BD: "Azja",
  AE: "Bliski Wschód", SA: "Bliski Wschód", QA: "Bliski Wschód", IL: "Bliski Wschód", TR: "Bliski Wschód", OM: "Bliski Wschód", KW: "Bliski Wschód",
  US: "Ameryka Płn.", CA: "Ameryka Płn.", MX: "Ameryka Płn.",
  BR: "Ameryka Płd.", AR: "Ameryka Płd.", CL: "Ameryka Płd.", CO: "Ameryka Płd.", PE: "Ameryka Płd.",
  EG: "Afryka", MA: "Afryka", ZA: "Afryka", NG: "Afryka", KE: "Afryka", TN: "Afryka", DZ: "Afryka",
  AU: "Oceania", NZ: "Oceania",
};

/** Words in an agent's "regions" field that mean the region. */
const KEYWORDS: Record<Region, string[]> = {
  Azja: ["azja", "chiny", "japonia", "korea", "indie", "wietnam", "kazachstan", "daleki wschod"],
  "Bliski Wschód": ["bliski wschod", "zatoka", "zea", "arabia", "turcja"],
  "Ameryka Płn.": ["ameryka pln", "usa", "kanada", "meksyk"],
  "Ameryka Płd.": ["ameryka pld", "brazylia", "ameryka lacinska"],
  Afryka: ["afryka", "maghreb"],
  Europa: ["europa", "morze srodziemne", "skandynawia", "wielka brytania"],
  Oceania: ["oceania", "australia"],
};

export function regionOf(country: string | null | undefined): Region | null {
  if (!country) return null;
  return COUNTRY_REGION[country.toUpperCase()] ?? "Europa";
}

const WORLDWIDE = ["caly swiat", "swiat", "worldwide", "global"];

export function servesRegion(regions: string, region: Region | null): boolean {
  const text = normalize(regions);
  if (WORLDWIDE.some((w) => text.includes(w))) return true;
  return region !== null && KEYWORDS[region].some((k) => text.includes(k));
}

/** The foreign end decides the region: from Poland to Shanghai is Asia, from Hamburg to Gdańsk is Europe. */
export function laneRegion(originCountry: string | null, destinationCountry: string | null): Region | null {
  const foreign = [destinationCountry, originCountry].find((c) => c && c.toUpperCase() !== "PL");
  return regionOf(foreign ?? destinationCountry ?? originCountry);
}

export const RFQ_MIN = 3;
export const RFQ_MAX = 5;

/** Up to five agents for the lane; when fewer than three cover it, the most responsive others fill in. */
export function pickRfqAgents<T extends { id: string; regions: string; replyRate: number }>(candidates: T[], region: Region | null): T[] {
  // Ties by id, so the same inquiry always goes to the same agents.
  const byReply = [...candidates].sort((a, b) => b.replyRate - a.replyRate || a.id.localeCompare(b.id));
  const covering = byReply.filter((a) => servesRegion(a.regions, region));
  const picked = covering.slice(0, RFQ_MAX);
  if (picked.length < RFQ_MIN) for (const a of byReply) if (picked.length < RFQ_MIN && !picked.includes(a)) picked.push(a);
  return picked;
}
