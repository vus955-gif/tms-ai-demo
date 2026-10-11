import { describe, expect, it } from "vitest";
import { CMR_AUTO_THRESHOLD, matchCmr, scoreCmr, type CmrCandidate } from "./cmr-matching";

const leipzig: CmrCandidate = {
  orderId: "zl-1035",
  number: "ZL-1035",
  references: ["LW-4410/10"],
  deliveryCity: "Leipzig",
  consigneeNames: ["Logistyka Wisła — odbiorca Leipzig GVZ", "Logistyka Wisła Sp. z o.o."],
  deliveryDates: ["09.10"],
};
const dresden: CmrCandidate = {
  orderId: "zl-1033",
  number: "ZL-1033",
  references: ["OC-ADR-5521", "UN 1993"],
  deliveryCity: "Dresden",
  consigneeNames: ["Odra Chem — odbiorca Dresden"],
  deliveryDates: ["09.10"],
};

describe("CMR matching", () => {
  it("matches reference, city and consignee above the automatic threshold", () => {
    const m = scoreCmr(
      { consignee: "Logistyka Wisla - odbiorca Leipzig GVZ", place_of_delivery: "Leipzig, DE", references: ["LW-4410/10"], delivery_date: "10.10.2026" },
      leipzig,
    );
    expect(m.score).toBeGreaterThanOrEqual(CMR_AUTO_THRESHOLD);
    expect(m.reasons).toEqual(expect.arrayContaining(["numer referencyjny LW-4410/10", "miejsce dostawy Leipzig", "odbiorca się zgadza"]));
  });

  it("tolerates spacing and punctuation in references", () => {
    expect(scoreCmr({ references: ["lw 4410 10"] }, leipzig).reasons[0]).toContain("LW-4410/10");
  });

  it("does not treat a shorter reference as a match", () => {
    const short = { ...leipzig, references: ["PO-12"] };
    expect(scoreCmr({ references: ["PO-1234"] }, short).reasons).toEqual([]);
    expect(scoreCmr({ references: ["-"] }, leipzig).reasons).toEqual([]);
  });

  it("stays below the threshold without a reference number", () => {
    const m = scoreCmr({ consignee: "Logistyka Wisła odbiorca Leipzig", place_of_delivery: "Leipzig" }, leipzig);
    expect(m.score).toBeLessThan(CMR_AUTO_THRESHOLD);
  });

  it("ranks the right order first and a foreign CMR low everywhere", () => {
    const fields = { consignee: "Odra Chem odbiorca Dresden", place_of_delivery: "Dresden, DE", references: ["OC-ADR-5521"] };
    expect(matchCmr(fields, [leipzig, dresden])[0].orderId).toBe("zl-1033");
    const foreign = { consignee: "Kowalski Budownictwo", place_of_delivery: "Kalisz, PL", references: ["NH-77120"] };
    expect(matchCmr(foreign, [leipzig, dresden]).every((m) => m.score < 0.3)).toBe(true);
  });
});
