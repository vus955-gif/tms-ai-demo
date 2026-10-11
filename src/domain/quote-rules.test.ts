import { describe, expect, it } from "vitest";
import { findPlace, greatCircleKm, placesIn } from "./gazetteer";
import { chargeableWeightKg, detectMode, extractQuoteByRules, missingFor, rfqSummary, roadVehicleFor } from "./quote-rules";
import { mentionsAmount, money, offerPrice, roadCalculation } from "./sales-pricing";

describe("Sales rules", () => {
  it("detects the transport mode", () => {
    expect(detectMode("Prosimy o ofertę na fracht morski FCL 40'")).toBe("sea");
    expect(detectMode("Transport lotniczy 2 palet do Toronto")).toBe("air");
    expect(detectMode("Kontener koleją z Chengdu do Małaszewicz")).toBe("rail");
    expect(detectMode("Ile za 10 palet Poznań – Lyon?")).toBe("road");
  });

  it("finds places, also declined, in order of appearance", () => {
    expect(placesIn("z Gdańska do Szanghaju").map((p) => p.name)).toEqual(["Gdańsk", "Shanghai"]);
    expect(placesIn("Poznania do Toronto").map((p) => p.name)).toEqual(["Poznań", "Toronto"]);
    expect(findPlace("Lipsk")?.name).toBe("Leipzig");
    const km = greatCircleKm(findPlace("Poznań")!, findPlace("Lyon")!);
    expect(km).toBeGreaterThan(1050);
    expect(km).toBeLessThan(1150);
  });

  it("reads a complete sea inquiry and finds nothing missing", () => {
    const d = extractQuoteByRules("Prosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t, gotowe do wysyłki od 25.10.");
    expect(d).toMatchObject({ origin: "Gdańsk", destination: "Shanghai", incoterms: "FOB", containerType: "40HC", containers: 1, seaType: "FCL", weightKg: 24000, readyDate: "25.10", commodity: "papier" });
    expect(missingFor("sea", d)).toEqual([]);
  });

  it("lists what an incomplete air inquiry lacks", () => {
    const d = extractQuoteByRules("Ile kosztowałby transport lotniczy 2 palet próbek (180 kg) z Poznania do Toronto? Termin elastyczny.");
    expect(d).toMatchObject({ origin: "Poznań", destination: "Toronto", weightKg: 180, packages: 2, commodity: "probek" });
    expect(missingFor("air", d)).toEqual(["incoterms", "wymiary lub objętość (CBM)"]);
    expect(chargeableWeightKg({ weightKg: 180, volumeCbm: 1.6 })).toBe(267);
  });

  it("reads multiple containers and keeps the client out of the RFQ", () => {
    const d = extractQuoteByRules("Logistyka Wisła: 2 x 20' koleją z Chengdu do Łodzi, CPT Łódź, 18 t, części maszyn, gotowe 30.10");
    expect(d).toMatchObject({ containers: 2, containerType: "20", origin: "Chengdu", destination: "Łódź", incoterms: "CPT" });
    const rfq = rfqSummary("rail", d);
    expect(rfq).toContain("2 × 20'");
    expect(rfq).not.toContain("Wisła");
  });

  it("picks the smallest road vehicle the load fits in", () => {
    expect(roadVehicleFor({ ...extractQuoteByRules("6 palet, 900 kg"), vehicleKind: null })).toBe("bus");
    expect(roadVehicleFor(extractQuoteByRules("14 palet, 6 t"))).toBe("solo");
    expect(roadVehicleFor(extractQuoteByRules("pełna naczepa 24 t"))).toBe("tractor");
  });
});

describe("Sales pricing", () => {
  const rate = { kind: "tractor" as const, label: "Ciągnik", perKmPln: 5.4, perKmEur: 1.35, minPln: 1000, minEur: 250 };

  it("adds the margin and rounds the offer up", () => {
    expect(offerPrice(1150, 12)).toBe(1288);
  });

  it("calculates a road quote with minimum, surcharges and margin", () => {
    const c = roadCalculation({ rate, domestic: false, loadedKm: 1420, kmSource: "szacunek", adr: true, reefer: false, adrPct: 15, reeferPct: 20, marginPct: 12 });
    expect(c.currency).toBe("EUR");
    expect(c.base).toBe(1917);
    expect(c.surcharges).toEqual([{ label: "ADR", pct: 15, amount: 287.55 }]);
    expect(c.cost).toBe(2204.55);
    expect(c.price).toBe(2470);
    const short = roadCalculation({ rate, domestic: true, loadedKm: 80, kmSource: "trasa", adr: false, reefer: false, adrPct: 15, reeferPct: 20, marginPct: 10 });
    expect(short.base).toBe(1000);
  });

  it("checks that a draft states the computed amount", () => {
    expect(money(2470, "EUR")).toBe("2 470 EUR");
    expect(mentionsAmount("Cena: 2 470 EUR netto", 2470)).toBe(true);
    expect(mentionsAmount("Cena: 2.470 EUR", 2470)).toBe(true);
    expect(mentionsAmount("Cena: 2 400 EUR", 2470)).toBe(false);
  });
});
