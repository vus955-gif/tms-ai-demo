import { normalize } from "./email-rules";

/** Rule-based reading of a freight agent's rate e-mail (fallback for the AI). */
export type AgentReplyReading = {
  available: boolean;
  price: number | null;
  currency: string | null;
  valid_until: string | null;
  transit_days: number | null;
  conditions: string | null;
};

export const CURRENCIES = ["USD", "EUR", "PLN"] as const;

/** "1 150", "1,150", "1.150", "2 400" → number; decimals with a comma or dot are kept. */
export function parseAmount(raw: string): number | null {
  const compact = raw.replace(/[\s\u00a0\u202f]/g, "");
  const noThousands = compact.replace(/[.,](?=\d{3}(\D|$))/g, "");
  const value = Number(noThousands.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function readAgentReplyByRules(text: string): AgentReplyReading {
  const t = normalize(text);
  if (/nie mamy miejsca|brak miejsca|cannot offer space|no space|not able to offer/.test(t)) {
    return { available: false, price: null, currency: null, valid_until: null, transit_days: null, conditions: null };
  }
  const amount = "(\\d[\\d\\s\\u00a0.,]*\\d|\\d)";
  const before = text.match(new RegExp(`\\b(USD|EUR|PLN)\\s*${amount}`));
  const after = text.match(new RegExp(`${amount}\\s*(USD|EUR|PLN)\\b`));
  let price: number | null = null;
  let currency: string | null = null;
  if (before && (!after || (before.index ?? 0) <= (after.index ?? 0))) {
    currency = before[1];
    price = parseAmount(before[2]);
  } else if (after) {
    currency = after[2];
    price = parseAmount(after[1]);
  }
  const valid = t.match(/(wazna do|valid until|validity)\s*:?\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/);
  const transit = t.match(/(tranzyt\w*|transit time|transit)\D{0,12}(\d{1,3})\s*(dni|days)/);
  const remarks = text.match(/(?:Uwagi|Remarks)\s*:\s*(.+)/i);
  return {
    available: price !== null,
    price,
    currency,
    valid_until: valid ? valid[2] : null,
    transit_days: transit ? Number(transit[2]) : null,
    conditions: remarks ? remarks[1].trim().slice(0, 300) : null,
  };
}
