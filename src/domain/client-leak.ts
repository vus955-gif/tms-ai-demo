import { normalize } from "./email-rules";

/**
 * Safety net for messages to freight agents: true when the text names the
 * client, one of its contacts (surname, e-mail), its e-mail domain or contains
 * a contact's phone number. Such a message is not sent.
 *
 * Company names often contain plain words that also describe goods
 * ("Sudety Papier" and "papier w rolach"), so a single generic word is not a
 * leak: it takes two consecutive words of the name, or its distinctive first word.
 */
const LEGAL_FORMS = new Set(["sp", "z", "o", "oo", "sa", "s", "a", "spolka", "sc", "gmbh", "ltd", "inc"]);
const GENERIC = new Set([
  "logistyka", "logistics", "meble", "papier", "foods", "food", "chem", "chemia", "retail", "electronics", "elektronika",
  "transport", "spedycja", "agro", "pol", "polska", "trade", "group", "service", "serwis", "handel", "export", "import",
]);

export function leaksClientData(text: string, client: { name: string; emailDomain?: string | null }, contacts: { name: string; email: string; phone: string }[]): boolean {
  const norm = normalize(text);
  const flat = ` ${norm.split(/[^a-z0-9]+/).filter(Boolean).join(" ")} `;
  const words = new Set(flat.trim().split(" "));
  const nameWords = normalize(client.name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL_FORMS.has(w));
  const bigrams = nameWords.slice(1).map((w, i) => `${nameWords[i]} ${w}`);
  if (bigrams.some((b) => flat.includes(` ${b} `))) return true;
  const first = nameWords[0];
  if (first && first.length >= 4 && !GENERIC.has(first) && words.has(first)) return true;
  if (client.emailDomain && norm.includes(normalize(client.emailDomain))) return true;
  const digits = text.replace(/\D/g, "");
  return contacts.some((c) => {
    const surname = normalize(c.name).split(/\s+/).pop() ?? "";
    const phone = c.phone.replace(/\D/g, "").slice(-9);
    return (surname.length >= 4 && words.has(surname)) || norm.includes(normalize(c.email)) || (phone.length === 9 && digits.includes(phone));
  });
}
