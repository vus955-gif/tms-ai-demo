/**
 * "Przekazanie zmiany": what the next dispatcher must know, gathered by code from the state of the
 * system. The facts are complete and ordered here; AI (when available) only turns them into a short
 * note a person would write, and the outgoing dispatcher edits and signs it off.
 */

export type HandoverFacts = {
  /** Local time of the handover, already formatted. */
  at: string;
  alerts: { severity: "critical" | "warning" | "info"; title: string; body: string }[];
  atRisk: { number: string; route: string; driver: string; risk: "red" | "yellow"; eta: string | null; deadline: string }[];
  unconfirmed: { number: string; driver: string; pickup: string }[];
  unassigned: { number: string; client: string; pickup: string }[];
  drafts: number;
  documents: { toClose: number; toVerify: number; illegible: number };
  inbox: { unread: number; replyDrafts: number };
  shipmentsDue: number;
  fleet: { overdue: string[]; soon: number };
  absences: { driver: string; label: string; from: string }[];
  pointSuggestions: number;
};

export type HandoverSection = { title: string; lines: string[] };

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

/** The facts as plain lines, most urgent first. This is the whole truth; the AI note may only shorten it. */
export function handoverSections(f: HandoverFacts): HandoverSection[] {
  // An order an alert already describes is not repeated as a separate "at risk" line.
  const inAlert = (number: string) => f.alerts.some((a) => `${a.title} ${a.body}`.includes(number));
  const urgent: string[] = [
    ...f.alerts.filter((a) => a.severity === "critical").map((a) => `${a.title}. ${a.body}`),
    ...f.atRisk.filter((o) => o.risk === "red" && !inAlert(o.number)).map((o) => `${o.number} (${o.route}, ${o.driver}): zagrożony termin${o.eta ? `, prognoza ${o.eta}` : ""}, okno do ${o.deadline}.`),
    ...f.fleet.overdue.map((t) => `Po terminie: ${t}.`),
  ];
  const watch: string[] = [
    ...f.alerts.filter((a) => a.severity === "warning").map((a) => `${a.title}. ${a.body}`),
    ...f.atRisk.filter((o) => o.risk === "yellow" && !inAlert(o.number)).map((o) => `${o.number} (${o.route}, ${o.driver}): mały zapas czasu${o.eta ? `, prognoza ${o.eta}` : ""}, okno do ${o.deadline}.`),
    ...f.unconfirmed.map((o) => `${o.number}: ${o.driver} nie potwierdził jeszcze zlecenia (załadunek ${o.pickup}).`),
    ...f.unassigned.map((o) => `${o.number} (${o.client}) czeka na kierowcę, załadunek ${o.pickup}.`),
  ];
  const queue: string[] = [];
  if (f.drafts) queue.push(`${f.drafts} ${plural(f.drafts, "szkic zlecenia czeka", "szkice zleceń czekają", "szkiców zleceń czeka")} na zatwierdzenie.`);
  const d = f.documents;
  if (d.toClose) queue.push(`CMR do zamknięcia zlecenia: ${d.toClose}.`);
  if (d.toVerify) queue.push(`CMR do ręcznej weryfikacji: ${d.toVerify}.`);
  if (d.illegible) queue.push(`Nieczytelne CMR, kierowca poproszony o nowe zdjęcie: ${d.illegible}.`);
  if (f.inbox.unread) queue.push(`Nieprzeczytane maile klientów: ${f.inbox.unread}.`);
  if (f.inbox.replyDrafts) queue.push(`Szkice odpowiedzi do klientów czekające na wysłanie: ${f.inbox.replyDrafts}.`);
  if (f.shipmentsDue) queue.push(`Przesyłki morskie, lotnicze i kolejowe z bliskim terminem statusu dla klienta: ${f.shipmentsDue}.`);
  if (f.pointSuggestions) queue.push(`Uwagi kierowców o punktach do rozpatrzenia: ${f.pointSuggestions}.`);
  const ahead: string[] = [...f.absences.map((a) => `${a.driver}: ${a.label} od ${a.from}.`)];
  if (f.fleet.soon) ahead.push(`Terminy floty w ciągu 30 dni lub 5 000 km: ${f.fleet.soon}.`);

  return [
    { title: "Pilne", lines: urgent },
    { title: "Do dopilnowania", lines: watch },
    { title: "Kolejki", lines: queue },
    { title: "Na horyzoncie", lines: ahead },
  ].filter((s) => s.lines.length > 0);
}

/** The note written without AI: the sections as they are. */
export function handoverNoteByRules(f: HandoverFacts): string {
  const sections = handoverSections(f);
  if (sections.length === 0) return `Przekazanie zmiany, ${f.at}.\n\nSpokojnie: brak alertów, zagrożonych zleceń i zaległych kolejek.`;
  return [`Przekazanie zmiany, ${f.at}.`, ...sections.map((s) => `${s.title}:\n${s.lines.map((l) => `- ${l}`).join("\n")}`)].join("\n\n");
}

/** Order numbers the facts mention — a note that names any other order is not built from the facts. */
export function knownOrderNumbers(f: HandoverFacts): Set<string> {
  const text = JSON.stringify(f);
  return new Set(text.match(/ZL-\d+/g) ?? []);
}
