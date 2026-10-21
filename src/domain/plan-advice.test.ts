import { describe, expect, it } from "vitest";
import { adviceByRules, type AdviceCandidate, type AdviceFacts } from "./plan-advice";

const cand = (over: Partial<AdviceCandidate>): AdviceCandidate => ({ driverId: "d-1", name: "Jan Nowak", plates: "PO 4K21", forecast: "zdazy", slackPickupMin: 90, slackDeliveryMin: 60, reasons: [], ...over });
const base: AdviceFacts = { templateName: "Agro-Pol: pasza", clientName: "Agro-Pol S.A.", date: "2026-10-21", deliveryTo: "16:00", defaultDriver: null, chosen: null, candidates: [], fixable: [], hard: [] };

describe("advice for a red or amber day", () => {
  it("offers a driver who makes it with room when the chosen one is tight", () => {
    const tight = cand({ driverId: "d-tight", name: "Ewa Kamińska", plates: "PO 2C19", forecast: "ryzyko", slackDeliveryMin: 12 });
    const roomy = cand({ driverId: "d-room", name: "Jan Nowak", plates: "PO 4K21", slackPickupMin: 80, slackDeliveryMin: 45 });
    const a = adviceByRules({ ...base, chosen: tight, candidates: [tight, roomy] });
    expect(a.summary).toBe("Ewa Kamińska (PO 2C19) zdąży na styk — zapas 12 min.");
    expect(a.options[0]).toEqual({ kind: "inny_kierowca", driverId: "d-room", text: "Przydziel kierowcę: Jan Nowak (PO 4K21) — zdąży z zapasem 45 min." });
  });

  it("names what keeps vehicles out when nobody can go, and suggests telling the client", () => {
    const a = adviceByRules({ ...base, fixable: ["GD 2M88: świadectwo ATP ważne tylko do 20.10", "EL 9K41: legalizacja tachografu po terminie"] });
    expect(a.summary).toMatch(/^Na 2026-10-21 nikt nie może teraz wziąć kursu „Agro-Pol: pasza”/);
    expect(a.options.map((o) => o.kind)).toEqual(["usun_przeszkode", "usun_przeszkode", "uprzedz_klienta"]);
    // "Too far to make it" is not an obstacle anyone can remove.
    expect(adviceByRules({ ...base, fixable: ["DW 7M02: nie zdąży na załadunek (ETA 11:30, okno do 08:00)"] }).options.map((o) => o.kind)).toEqual(["uprzedz_klienta"]);
    expect(a.options[2].text).toMatch(/Agro-Pol S\.A\..*do 16:00/);
  });

  it("when only the usual driver is out: give the run to the one who makes it, and fix the usual driver's obstacle", () => {
    const a = adviceByRules({
      ...base,
      defaultDriver: { name: "Adam Dąbrowski", plates: "EL 9K41", ok: false, reason: "legalizacja tachografu po terminie" },
      chosen: cand({ slackPickupMin: 322, slackDeliveryMin: 400 }),
      candidates: [cand({}), cand({ driverId: "d-2", name: "Michał Woźniak", plates: "PO 8Z55" })],
      fixable: ["DW 7M02: nie zdąży na załadunek (ETA 11:30, okno do 08:00)"],
    });
    expect(a.summary).toBe("Zwykły kierowca Adam Dąbrowski nie może: legalizacja tachografu po terminie. Jan Nowak (PO 4K21) zdąży.");
    expect(a.options).toEqual([
      { kind: "inny_kierowca", driverId: "d-1", text: "Daj kurs kierowcy: Jan Nowak (PO 4K21) — zdąży z zapasem 5 h 22 min." },
      { kind: "usun_przeszkode", text: "Adam Dąbrowski: legalizacja tachografu po terminie — po załatwieniu wróci do tego kursu." },
    ]);
  });

  it("does not call a vehicle that cannot carry the load an obstacle to fix", () => {
    const a = adviceByRules({ ...base, defaultDriver: { name: "Anna Wiśniewska", plates: "GD 2M88", ok: false, reason: "za mała pojemność: 34 palet (mieści 33)", hard: true }, chosen: cand({}), candidates: [cand({})] });
    expect(a.options[1].text).toBe("Anna Wiśniewska nie pasuje do tego kursu (za mała pojemność: 34 palet (mieści 33)) — zmień zwykłego kierowcę w szablonie.");
  });
});
