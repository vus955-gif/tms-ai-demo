import { describe, expect, it } from "vitest";
import { categorizeEmail, extractOrderByRules, findRelatedOrder, type RulePoint } from "./email-rules";

const points: RulePoint[] = [
  { id: "pt-wisla-gadki", name: "Logistyka Wisła — magazyn Gądki", city: "Gądki" },
  { id: "pt-wisla-lipsk", name: "Logistyka Wisła — odbiorca Leipzig GVZ", city: "Leipzig" },
  { id: "pt-wisla-grossbeeren", name: "Logistyka Wisła — odbiorca Großbeeren", city: "Großbeeren" },
];
// Wednesday 14.10.2026, 09:10 in Warsaw.
const simNow = new Date("2026-10-14T07:10:00Z");

const ORDER_MAIL = `Dzień dobry,
prosimy o transport na jutro.
Załadunek: magazyn Gądki, jutro 07:00–09:00.
Rozładunek: Leipzig GVZ, jutro 13:00–15:00.
12 palet EUR, 4800 kg, towar neutralny. Nr ref.: LW-5501.
Pozdrawiam, Marta Sobczak`;

describe("client e-mail rules", () => {
  it("recognises the categories", () => {
    expect(categorizeEmail("Zlecenie transportu", ORDER_MAIL).category).toBe("zamowienie_transportu");
    expect(categorizeEmail("Gdzie jest auto?", "Dzień dobry, gdzie jest auto z zamówieniem ME-PO-33190? Kiedy dojedzie?").category).toBe("zapytanie_o_status");
    const complaint = categorizeEmail("Reklamacja dostawy", "Przy rozładunku stwierdziliśmy uszkodzone 2 palety.");
    expect(complaint).toMatchObject({ category: "reklamacja", priority: "wysoki" });
    expect(categorizeEmail("Zapytanie o wycenę", "Prosimy o ofertę na FCL 40' Szanghaj – Gdańsk, incoterms FOB.").category).toBe("zapytanie_ofertowe");
    expect(categorizeEmail("Faktura 118/10", "Prosimy o korektę faktury, zły NIP.").category).toBe("inne");
  });

  it("finds the order by number or reference", () => {
    const orders = [
      { id: "zl-1037", number: "ZL-1037", references: ["ME-PO-33190"] },
      { id: "zl-1040", number: "ZL-1040", references: [] },
    ];
    expect(findRelatedOrder("gdzie jest auto z ME-PO-33190?", orders)).toBe("zl-1037");
    expect(findRelatedOrder("status zl 1040 proszę", orders)).toBe("zl-1040");
    expect(findRelatedOrder("gdzie jest moje auto?", orders)).toBeNull();
  });

  it("extracts a structured order with points from the client's book", () => {
    const o = extractOrderByRules(ORDER_MAIL, points, simNow);
    expect(o.pickup_point_id).toBe("pt-wisla-gadki");
    expect(o.delivery_point_id).toBe("pt-wisla-lipsk");
    expect(o.pickup_from).toBe("2026-10-15T05:00:00.000Z");
    expect(o.pickup_to).toBe("2026-10-15T07:00:00.000Z");
    expect(o.delivery_from).toBe("2026-10-15T11:00:00.000Z");
    expect(o.delivery_to).toBe("2026-10-15T13:00:00.000Z");
    expect(o.pallets).toBe(12);
    expect(o.kg).toBe(4800);
    expect(o.references).toEqual(["LW-5501"]);
    expect(o.adr).toBe(false);
    expect(o.reefer).toBe(false);
  });

  it("understands German names, explicit dates, tonnes and lists what is missing", () => {
    const o = extractOrderByRules("Odbiór z Gądek 16.10 od 8 do 10, dostawa do Lipska. 2,5 t, ADR kl. 3.", points, simNow);
    expect(o.pickup_point_id).toBe("pt-wisla-gadki");
    expect(o.delivery_point_id).toBe("pt-wisla-lipsk");
    expect(o.pickup_from).toBe("2026-10-16T06:00:00.000Z");
    expect(o.kg).toBe(2500);
    expect(o.adr).toBe(true);
    expect(o.missing_fields).toEqual(expect.arrayContaining(["okno rozładunku", "liczba palet"]));
  });
});
