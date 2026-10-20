import { describe, expect, it } from "vitest";
import { checkDrop, checkHook, type SwapInput, type SwapTrailer } from "./trailer-swap";

const names: Record<string, string> = { "pt-baza-lodz": "Baza Łódź", "pt-baza-poznan": "Baza Poznań" };
const base: SwapInput = { vehicle: { kind: "tractor", plates: "EL 9K41" }, idleAtPointId: "pt-baza-lodz", inProgressOrder: null, assigned: [], pointName: (id) => names[id] ?? id };
const reefer: SwapTrailer = { id: "tr-el40cz", plates: "EL 40CZ", body: "chlodnia", capacityPallets: 33, capacityKg: 22_000, adr: false, parkedAtPointId: "pt-baza-lodz", overdueBlocking: [] };

describe("trailer swap rules", () => {
  it("lets an empty tractor take a trailer standing at the same yard", () => {
    expect(checkHook(base, reefer)).toEqual({ blockers: [], warnings: [] });
  });

  it("stops a swap while cargo is on board, on the road, or with the trailer elsewhere", () => {
    expect(checkHook({ ...base, inProgressOrder: "ZL-1033" }, reefer).blockers[0]).toMatch(/wiezie ładunek zlecenia ZL-1033/);
    expect(checkHook({ ...base, idleAtPointId: null }, reefer).blockers[0]).toMatch(/w trasie/);
    expect(checkHook(base, { ...reefer, parkedAtPointId: "pt-baza-poznan" }).blockers[0]).toBe(
      "Naczepa EL 40CZ stoi w: Baza Poznań, a ciągnik w: Baza Łódź. Przepnij, gdy kierowca tam dojedzie.",
    );
    expect(checkHook(base, { ...reefer, parkedAtPointId: null }).blockers[0]).toMatch(/pod innym ciągnikiem/);
    expect(checkHook({ ...base, vehicle: { kind: "bus", plates: "WX 9T04" } }, reefer).blockers[0]).toMatch(/to nie ciągnik/);
  });

  it("warns about assigned orders the new trailer cannot carry, and overdue inspections", () => {
    const curtain: SwapTrailer = { ...reefer, plates: "PO 11RS", body: "plandeka", capacityPallets: 33, overdueBlocking: ["przegląd techniczny"] };
    const check = checkHook(
      {
        ...base,
        assigned: [
          { number: "ZL-1040", cargoPallets: 20, cargoKg: 9_000, bodyRequired: "chlodnia", adrRequired: false },
          { number: "ZL-1041", cargoPallets: 34, cargoKg: 9_000, bodyRequired: null, adrRequired: true },
        ],
      },
      curtain,
    );
    expect(check.blockers).toEqual([]);
    expect(check.warnings).toEqual([
      "ZL-1040 wymaga chłodni — PO 11RS to plandeka.",
      "ZL-1041 to ładunek ADR — ani EL 9K41, ani PO 11RS nie ma wyposażenia ADR.",
      "ZL-1041: 34 palet, a PO 11RS mieści 33.",
      "PO 11RS: przegląd techniczny po terminie — z tą naczepą ciągnik nie dostanie nowych zleceń.",
    ]);
  });

  it("counts the tractor's own ADR kit, like matching does", () => {
    const adrOrder = { number: "ZL-1050", cargoPallets: 10, cargoKg: 5_000, bodyRequired: null, adrRequired: true };
    expect(checkHook({ ...base, vehicle: { kind: "tractor", plates: "DW 3H56", adr: true }, assigned: [adrOrder] }, reefer).warnings).toEqual([]);
  });

  it("drops a trailer only on a stop, warning about orders that need it", () => {
    expect(checkDrop(base, reefer)).toEqual({ blockers: [], warnings: [] });
    expect(checkDrop(base, null).blockers).toEqual(["Ciągnik nie ma naczepy."]);
    expect(checkDrop({ ...base, assigned: [{ number: "ZL-1040", cargoPallets: 5, cargoKg: 1_000, bodyRequired: null, adrRequired: false }] }, reefer).warnings[0]).toMatch(/ZL-1040/);
  });
});
