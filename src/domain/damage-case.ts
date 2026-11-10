import { CARRIER_SIGNATURE } from "./carrier";

/**
 * "Asystent szkód": a consignee's remark on the CMR ("2 palety uszkodzone", "brak 3 kartonów") starts a
 * damage case. The model only classifies the remark and words the e-mail; the steps, the deadlines and
 * the "admit nothing" rule are fixed here, and the dispatcher decides what is sent.
 */

export const DAMAGE_KINDS = ["uszkodzenie", "brak", "opoznienie", "inne"] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

export const DAMAGE_KIND_LABEL: Record<DamageKind, string> = {
  uszkodzenie: "uszkodzenie ładunku",
  brak: "brak ilościowy",
  opoznienie: "opóźnienie dostawy",
  inne: "inne zastrzeżenie",
};

export type DamageStep = { id: string; text: string };

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");

/** Rule-based reading of the remark, used without AI. */
export function damageKindByRules(remark: string): DamageKind {
  const t = strip(remark);
  if (/\b(brak|braku|brakuje|niedobor|mniej|niekompletn|nie dostarczono)/.test(t)) return "brak";
  if (/\b(uszkodz|zgniec|pekni|rozbit|zalan|mokr|zamoczon|przemoczon|rozerwan|pogiet|zniszcz|stluczon|wgniec)/.test(t)) return "uszkodzenie";
  if (/\b(opozni|spozni|po terminie|za pozno)/.test(t)) return "opoznienie";
  return "inne";
}

/**
 * What to do, in order. International carriage runs under the CMR Convention: a reservation about
 * visible damage must be made at delivery (the remark on the CMR is that reservation), about hidden
 * damage within 7 days of delivery not counting Sundays and public holidays, about delay within
 * 21 days (art. 30); claims lapse after one year (art. 32). Domestic carriage runs under the Polish
 * transport law, whose deadlines differ — the checklist then points to the insurer instead of quoting them.
 */
export function damageChecklist(kind: DamageKind, international: boolean): { steps: DamageStep[]; notes: string[] } {
  const steps: DamageStep[] = [
    { id: "zdjecia", text: kind === "opoznienie" ? "Zbierz od kierowcy opis przebiegu trasy i przyczyn opóźnienia." : "Poproś kierowcę o zdjęcia ładunku i opakowań oraz krótki opis, co zastał przy rozładunku." },
    { id: "dokumenty", text: "Zabezpiecz CMR z adnotacją odbiorcy i poproś odbiorcę o protokół szkody, jeśli go spisano." },
    { id: "klient", text: "Poinformuj klienta: szkic maila jest w Skrzynce. Przeczytaj go przed wysłaniem." },
    { id: "ubezpieczyciel", text: "Zgłoś zdarzenie ubezpieczycielowi OCP przewoźnika w terminie z polisy." },
    { id: "bez_uznania", text: "Nie uznawaj roszczenia ani kwoty i nie obiecuj rekompensaty, dopóki nie uzgodnisz tego z ubezpieczycielem." },
  ];
  const notes = international
    ? [
        "Przewóz międzynarodowy: obowiązuje Konwencja CMR.",
        "Adnotacja odbiorcy na CMR jest zastrzeżeniem złożonym przy dostawie (art. 30 CMR).",
        "Szkody niewidoczne z zewnątrz odbiorca może zgłosić pisemnie w ciągu 7 dni od dostawy, nie licząc niedziel i świąt; opóźnienie w ciągu 21 dni (art. 30 CMR).",
        "Roszczenia z przewozu przedawniają się po roku (art. 32 CMR).",
      ]
    : ["Przewóz krajowy: obowiązuje polskie Prawo przewozowe, a nie Konwencja CMR. Terminy zgłoszeń i przedawnienia sprawdź z ubezpieczycielem lub prawnikiem."];
  notes.push("To lista kontrolna dla spedytora, nie porada prawna.");
  return { steps, notes };
}

export type DamageFacts = { orderNumber: string; references: string[]; route: string; deliveredOn: string | null; remark: string; stamp: boolean | null; signature: boolean | null };

/** The e-mail to the client when AI is unavailable or its draft fails the checks: facts only, no admission. */
export function damageMailTemplate(facts: DamageFacts): { subject: string; body: string } {
  const ref = facts.references.length ? ` (ref. ${facts.references.join(", ")})` : "";
  return {
    subject: `Zlecenie ${facts.orderNumber}: zastrzeżenie odbiorcy przy dostawie`,
    body: [
      "Dzień dobry,",
      "",
      `przy dostawie zlecenia ${facts.orderNumber}${ref}, ${facts.route}${facts.deliveredOn ? `, ${facts.deliveredOn}` : ""}, odbiorca wpisał na liście przewozowym CMR zastrzeżenie:`,
      `„${facts.remark}”`,
      "",
      "Wyjaśniamy okoliczności i zbieramy dokumentację. Prosimy o przesłanie dokumentów, którymi Państwo dysponują: protokołu szkody, zdjęć oraz informacji o wartości towaru, którego dotyczy zastrzeżenie.",
      "Wrócimy do Państwa z informacją o dalszych krokach.",
      "",
      "Pozdrawiam",
      CARRIER_SIGNATURE,
    ].join("\n"),
  };
}

/**
 * A draft may state facts and next steps, never accept liability or promise money: most carrier
 * liability policies make the insurer's consent a condition of cover.
 */
export function admitsLiability(text: string): boolean {
  const t = strip(text);
  return /\b(przyjmujemy odpowiedzialnosc|bierzemy odpowiedzialnosc|ponosimy odpowiedzialnosc|uznajemy (roszczenie|reklamacje|szkode)|nasza wina|z naszej winy|pokryjemy|zwrocimy|wyplacimy|zrekompensujemy|rekompensat|odszkodowanie (zostanie|bedzie) wyplacone|gwarantujemy zwrot)/.test(t);
}
