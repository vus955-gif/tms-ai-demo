/**
 * Client tax number: a Polish NIP (10 digits with a checksum, optional "PL"
 * prefix) or a foreign EU VAT number (country prefix + 2–13 letters/digits,
 * format only — the real check is the EU VIES service).
 */
export type TaxIdCheck = { ok: true; normalized: string } | { ok: false; error: string };

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export function isValidNip(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const sum = NIP_WEIGHTS.reduce((s, w, i) => s + w * Number(digits[i]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(digits[9]);
}

export function checkTaxId(raw: string): TaxIdCheck {
  const compact = raw.replace(/[\s.-]/g, "").toUpperCase();
  if (compact === "") return { ok: true, normalized: "" };
  const nip = compact.startsWith("PL") ? compact.slice(2) : compact;
  if (/^\d+$/.test(nip)) {
    return isValidNip(nip) ? { ok: true, normalized: nip } : { ok: false, error: "NIP: 10 cyfr z poprawną cyfrą kontrolną" };
  }
  if (/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(compact)) return { ok: true, normalized: compact };
  return { ok: false, error: "NIP albo numer VAT UE (np. DE123456789)" };
}
