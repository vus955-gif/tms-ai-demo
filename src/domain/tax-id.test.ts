import { describe, expect, it } from "vitest";
import { checkTaxId, isValidNip } from "./tax-id";

// Built for the test with the NIP checksum (weights 6,5,7,2,3,4,5,6,7, sum mod 11): 123456788 → sum 223, 223 mod 11 = 3.
const VALID = "1234567883";

describe("client tax number", () => {
  it("checks the Polish NIP checksum", () => {
    expect(isValidNip(VALID)).toBe(true);
    expect(isValidNip("1234567882")).toBe(false);
    // 123456789 gives a remainder of 10: no valid NIP starts with these digits.
    expect(isValidNip("1234567890")).toBe(false);
    expect(isValidNip("123456789")).toBe(false);
  });

  it("accepts NIP with dashes, spaces or the PL prefix and normalises it", () => {
    expect(checkTaxId("123-456-78-83")).toEqual({ ok: true, normalized: VALID });
    expect(checkTaxId("PL 123 456 78 83")).toEqual({ ok: true, normalized: VALID });
  });

  it("accepts an empty value (optional in the demo) and a foreign VAT number by format", () => {
    expect(checkTaxId("")).toEqual({ ok: true, normalized: "" });
    expect(checkTaxId("de 123456789")).toEqual({ ok: true, normalized: "DE123456789" });
  });

  it("explains what is wrong in Polish", () => {
    expect(checkTaxId("123-456-78-82")).toEqual({ ok: false, error: "NIP: 10 cyfr z poprawną cyfrą kontrolną" });
    expect(checkTaxId("abc")).toMatchObject({ ok: false });
  });
});
