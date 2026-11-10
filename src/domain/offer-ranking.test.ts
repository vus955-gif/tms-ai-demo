import { describe, expect, it } from "vitest";
import { clampWeight, profileLabel, rankingTextByRules, rankOffers, type Offer } from "./offer-ranking";

const offers: Offer[] = [
  { id: "tani-wolny", price: 2000, currency: "USD", transitDays: 40 },
  { id: "drogi-szybki", price: 2600, currency: "USD", transitDays: 28 },
  { id: "srodek", price: 2200, currency: "USD", transitDays: 34 },
];
const order = (weight: number) => rankOffers(offers, weight).ranked.map((r) => r.id);

describe("offer ranking against the client's quoting profile", () => {
  it("follows the profile: price-minded clients get the cheap offer first, urgent ones the fast one", () => {
    expect(order(85)).toEqual(["tani-wolny", "srodek", "drogi-szybki"]);
    expect(order(15)).toEqual(["drogi-szybki", "srodek", "tani-wolny"]);
    expect(order(100)[0]).toBe("tani-wolny");
    expect(order(0)[0]).toBe("drogi-szybki");
  });

  it("scores against the best offer, so the percentages mean something", () => {
    const { ranked } = rankOffers(offers, 85);
    // Cheapest: full marks on price (85), 28/40 on time (15 × 0.7 = 10.5).
    expect(ranked[0]).toEqual({ id: "tani-wolny", fitPct: 96, reasons: ["najtańsza", "o 12 dni dłużej niż najszybsza"] });
    expect(ranked.find((r) => r.id === "drogi-szybki")).toEqual({ id: "drogi-szybki", fitPct: 80, reasons: ["o 30% droższa od najtańszej", "najszybsza"] });
    // One offer that is both the cheapest and the fastest fits completely.
    expect(rankOffers([{ id: "a", price: 900, currency: "EUR", transitDays: 3 }], 50).ranked[0].fitPct).toBe(100);
  });

  it("does not punish a missing transit time, and says it is missing", () => {
    const { ranked } = rankOffers([...offers, { id: "bez-czasu", price: 2000, currency: "USD", transitDays: null }], 50);
    const row = ranked.find((r) => r.id === "bez-czasu")!;
    expect(row.reasons).toEqual(["najtańsza", "agent nie podał czasu tranzytu"]);
    expect(row.fitPct).toBe(75);
  });

  it("refuses to compare prices across currencies and ranks by time alone", () => {
    const mixed = rankOffers([offers[0], { id: "eur", price: 1900, currency: "EUR", transitDays: 30 }], 85);
    expect(mixed.note).toContain("różnych walutach");
    expect(mixed.ranked.map((r) => r.id)).toEqual(["eur", "tani-wolny"]);
    expect(mixed.ranked[0].reasons).toEqual(["najszybsza"]);
  });

  it("breaks ties in favour of the cheaper offer and handles an empty list", () => {
    const tie = rankOffers(
      [
        { id: "b", price: 1000, currency: "USD", transitDays: 10 },
        { id: "a", price: 1000, currency: "USD", transitDays: 10 },
      ],
      50,
    );
    expect(tie.ranked.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rankOffers([], 50)).toEqual({ ranked: [], note: null });
  });

  it("labels profiles and clamps the weight", () => {
    expect([profileLabel(85), profileLabel(50), profileLabel(15)]).toEqual(["liczy się głównie cena", "cena i czas są równie ważne", "liczy się głównie czas"]);
    expect([clampWeight(140), clampWeight(-5), clampWeight(49.6)]).toEqual([100, 0, 50]);
  });

  it("writes the recommendation without AI from the same facts", () => {
    const text = rankingTextByRules({
      client: "Sudety Papier Sp. z o.o.",
      profile: "liczy się głównie cena",
      priceWeight: 85,
      clientNote: "",
      offers: [
        { company: "Baltic Sea Lines", price: "2 000 USD", transit: "40 dni", fitPct: 96, reasons: ["najtańsza", "o 12 dni dłużej niż najszybsza"], conditions: null, validUntil: null },
        { company: "North Star", price: "2 200 USD", transit: "34 dni", fitPct: 90, reasons: ["o 10% droższa od najtańszej", "o 6 dni dłużej niż najszybsza"], conditions: null, validUntil: null },
      ],
      note: null,
    });
    expect(text).toBe(
      "Najbliżej profilu klienta (liczy się głównie cena) jest oferta Baltic Sea Lines: 2 000 USD, 40 dni; najtańsza, o 12 dni dłużej niż najszybsza. Dopasowanie 96%. Druga w kolejności: North Star (90%): o 10% droższa od najtańszej, o 6 dni dłużej niż najszybsza.",
    );
  });
});
