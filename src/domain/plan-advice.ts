/**
 * Advice for a red or amber day in the weekly plan of recurring orders. The algorithm
 * has already computed every candidate and their slack; these rules turn that into what a
 * forwarder can do. AI may phrase it better, but only from these facts (see ai/functions/plan-advice).
 */

export type AdviceCandidate = {
  driverId: string;
  name: string;
  plates: string;
  /** "zdazy" with room, "ryzyko" when the slack is thin. */
  forecast: "zdazy" | "ryzyko";
  slackPickupMin: number | null;
  slackDeliveryMin: number | null;
  reasons: string[];
};

export type AdviceFacts = {
  templateName: string;
  clientName: string;
  date: string;
  deliveryTo: string;
  /** `hard`: the driver's vehicle cannot carry this load at all (body, ADR, capacity) — nothing to fix. */
  defaultDriver: { name: string; plates: string; ok: boolean; reason: string; hard?: boolean } | null;
  /** Who the plan would give it to now (default driver if fit, else the best one). */
  chosen: AdviceCandidate | null;
  candidates: AdviceCandidate[];
  /** Vehicles that fit the load but are out for now: "PO 2C19: OC po terminie". */
  fixable: string[];
  hard: string[];
};

export type AdviceOption = { kind: "inny_kierowca" | "usun_przeszkode" | "uprzedz_klienta"; text: string; driverId?: string };
export type Advice = { summary: string; options: AdviceOption[] };

/** "45 min", "5 h 22 min". */
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

const slackText = (c: AdviceCandidate) => {
  const s = [c.slackPickupMin, c.slackDeliveryMin].filter((x): x is number => x !== null);
  return s.length ? minutes(Math.min(...s)) : "bez danych";
};

/** Obstacles a person can remove (a deadline to renew, an absence to rearrange) — not "too far to make it". */
const removable = (x: string) => !/nie zdąży|nie dojedzie|za dalek/i.test(x);

export function adviceByRules(f: AdviceFacts): Advice {
  const options: AdviceOption[] = [];
  const usualOut = f.defaultDriver && !f.defaultDriver.ok;
  if (f.chosen && f.chosen.forecast === "zdazy" && usualOut) {
    // The run is safe with someone else; the plan alone would leave it unassigned (it only assigns the usual driver).
    options.push({ kind: "inny_kierowca", driverId: f.chosen.driverId, text: `Daj kurs kierowcy: ${f.chosen.name} (${f.chosen.plates}) — zdąży z zapasem ${slackText(f.chosen)}.` });
    if (f.defaultDriver!.hard) options.push({ kind: "usun_przeszkode", text: `${f.defaultDriver!.name} nie pasuje do tego kursu (${f.defaultDriver!.reason}) — zmień zwykłego kierowcę w szablonie.` });
    else if (removable(f.defaultDriver!.reason)) options.push({ kind: "usun_przeszkode", text: `${f.defaultDriver!.name}: ${f.defaultDriver!.reason} — po załatwieniu wróci do tego kursu.` });
  } else {
    const better = f.candidates.find((c) => c.forecast === "zdazy" && c.driverId !== f.chosen?.driverId);
    if (better) options.push({ kind: "inny_kierowca", driverId: better.driverId, text: `Przydziel kierowcę: ${better.name} (${better.plates}) — zdąży z zapasem ${slackText(better)}.` });
    for (const x of f.fixable.filter(removable).slice(0, better ? 1 : 2)) options.push({ kind: "usun_przeszkode", text: `${x} — po załatwieniu pojazd wraca do gry.` });
    const tightDelivery = f.chosen && f.chosen.slackDeliveryMin !== null && f.chosen.slackDeliveryMin < 30;
    if (!better && (tightDelivery || !f.chosen)) {
      options.push({ kind: "uprzedz_klienta", text: `Uprzedź klienta (${f.clientName}) wcześniej albo poproś o szersze okno rozładunku (teraz do ${f.deliveryTo}).` });
    }
  }

  let summary: string;
  if (!f.chosen) {
    summary = f.fixable.length
      ? `Na ${f.date} nikt nie może teraz wziąć kursu „${f.templateName}”. Najbliżej są: ${f.fixable.slice(0, 2).join("; ")}.`
      : `Na ${f.date} brak pojazdu do kursu „${f.templateName}”${f.hard.length ? `: ${f.hard.slice(0, 2).join("; ")}` : ""}.`;
  } else {
    const who = `${f.chosen.name} (${f.chosen.plates})`;
    const def = usualOut ? `Zwykły kierowca ${f.defaultDriver!.name} nie może: ${f.defaultDriver!.reason}. ` : "";
    summary = `${def}${f.chosen.forecast === "ryzyko" ? `${who} zdąży na styk — zapas ${slackText(f.chosen)}.` : `${who} zdąży.`}`;
  }
  return { summary, options: options.slice(0, 3) };
}
