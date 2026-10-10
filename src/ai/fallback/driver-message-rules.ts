import type { DriverMessageCategory, MessagePriority } from "@/db/schema";

export type DriverMessageClassification = {
  category: DriverMessageCategory;
  subtype: "awaria" | "opoznienie" | "kontrola" | "wypadek" | "inne" | null;
  summary: string;
  priority: MessagePriority;
  confidence: number;
  suggested_replies: string[];
};

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .trim();

const REFUSAL = /\b(nie (dam rady|pojade|moge|zdaze|biore|przyjme|jade)|odmawiam|rezygnuj|mam wolne|jestem chory|auto w serwisie|nie ma mowy)\b/;
const ROAD_PROBLEM: [RegExp, DriverMessageClassification["subtype"]][] = [
  [/\b(awari|zepsu|guma|gume|opon|przebit|silnik|nie odpala)/, "awaria"],
  [/\b(wypadek|wypadku|kolizj|stluczk)/, "wypadek"],
  [/\b(kontrol|itd|policj|inspekcj|waga)/, "kontrola"],
  [/\b(korek|korku|opozni|spozni|utknal|stoje w|zator|objazd)/, "opoznienie"],
];
const DOCUMENT = /\b(cmr|zdjeci|foto|dokument|zalacz|w zalaczniku|skan)/;
const CLEAN_CONFIRM = /^(ok|okej|okey|oki|dobra|jasne|przyjmuje|przyjalem|przyjelam|potwierdzam|jade|jedziemy|tak|git|spoko|zrobione|biore)[\s!.,]*(jade|jedziemy|przyjmuje|potwierdzam|biore)?[\s!.,]*$|^(👍|✅)+$/u;
const CONFIRM_START = /^(ok|okej|okey|oki|dobra|jasne|przyjmuje|przyjalem|potwierdzam|jade|tak|spoko|biore)\b/;
const CONDITION = /\b(ale|tylko|pod warunkiem|chyba ze|jesli|jezeli|dopiero)\b/;
const QUESTION_WORD = /\b(jaki|jaka|jakie|ktory|ktora|ktore|gdzie|kiedy|ile|czy|o ktorej|numer rampy)\b/;
const SMALL_TALK = /\b(dzien dobry|czesc|witam|pozdrawiam|dzieki|dziekuje|parking|mop|przerwe|kawa|wszystko ok|jestem na)\b/;

const REPLIES: Record<DriverMessageCategory, string[]> = {
  potwierdzenie: ["Dzięki, szerokiej drogi.", "Dzięki. Daj znać po załadunku."],
  odmowa: ["Rozumiem, szukam innego kierowcy.", "Zadzwoń do mnie, porozmawiamy o tym zleceniu."],
  warunek_pytanie: ["Sprawdzę i zaraz odpiszę.", "Zadzwoń do mnie, ustalimy szczegóły."],
  operacyjne: ["Przyjąłem, informuję klienta. Daj znać, jak ruszysz.", "Jesteś bezpieczny? Zadzwoń, jak będziesz mógł."],
  dokument: ["Dzięki, dokument dotarł.", "Zdjęcie nieczytelne — wyślij proszę jeszcze raz."],
  luzne: ["Dzięki za info, szerokiej drogi.", "OK, dzięki."],
  niejasne: ["Nie do końca rozumiem — możesz napisać jaśniej?", "Zadzwoń do mnie, proszę."],
};

/** Rule-based fallback when AI is unavailable (spec §9.2). Confident only for unambiguous short answers. */
export function classifyByRules(raw: string, hasAttachment = false): DriverMessageClassification {
  const text = strip(raw);
  const result = (
    category: DriverMessageCategory,
    priority: MessagePriority,
    confidence: number,
    summary: string,
    subtype: DriverMessageClassification["subtype"] = null,
  ): DriverMessageClassification => ({ category, subtype, summary, priority, confidence, suggested_replies: REPLIES[category] });

  if (hasAttachment || DOCUMENT.test(text)) return result("dokument", "normalny", 0.7, "Kierowca przesłał dokument lub zdjęcie.");
  if (REFUSAL.test(text)) return result("odmowa", "wysoki", text.length <= 120 ? 0.8 : 0.6, "Kierowca odmawia realizacji zlecenia.");
  for (const [re, subtype] of ROAD_PROBLEM) {
    if (re.test(text)) return result("operacyjne", "wysoki", 0.6, `Zgłoszenie z trasy: ${subtype}.`, subtype);
  }
  if (CLEAN_CONFIRM.test(text)) return result("potwierdzenie", "normalny", 0.8, "Kierowca potwierdza zlecenie.");
  if (CONFIRM_START.test(text) && (CONDITION.test(text) || text.includes("?"))) {
    return result("warunek_pytanie", "wysoki", 0.6, "Kierowca potwierdza z warunkiem lub pytaniem.");
  }
  if (text.includes("?") || QUESTION_WORD.test(text)) return result("warunek_pytanie", "normalny", 0.6, "Kierowca ma pytanie.");
  if (CONFIRM_START.test(text)) return result("potwierdzenie", "normalny", 0.6, "Kierowca chyba potwierdza zlecenie.");
  if (SMALL_TALK.test(text)) return result("luzne", "niski", 0.6, "Luźna wiadomość, bez sprawy do załatwienia.");
  return result("niejasne", "normalny", 0.4, "Nie udało się rozpoznać, o co chodzi.");
}
