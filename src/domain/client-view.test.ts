import { describe, expect, it } from "vitest";
import { clientView, leaksDriverData } from "./client-view";

const base = {
  number: "ZL-1037",
  plates: "WB 6P77",
  trailerPlates: "WB 1234N",
  eta: new Date("2026-10-14T13:20:00Z"),
  pickupFrom: new Date("2026-10-14T02:30:00Z"),
  pickupTo: new Date("2026-10-14T04:00:00Z"),
  pickupCity: "Błonie",
  deliveryFrom: new Date("2026-10-14T13:30:00Z"),
  deliveryTo: new Date("2026-10-14T15:30:00Z"),
  deliveryLegProgress: 0.42,
  references: ["ME-PO-33190"],
  deliveryCity: "Praha",
};

describe("clientView", () => {
  it("shows plates, status, ETA and progress while on the road", () => {
    const v = clientView({ ...base, status: "W_DRODZE" });
    expect(v).toMatchObject({ number: "ZL-1037", plates: "WB 6P77", trailerPlates: "WB 1234N", status: "w drodze do odbiorcy", progressPct: 42 });
    expect(v.eta).toBe("2026-10-14T13:20:00.000Z");
  });

  it("hides plates before a truck is assigned and ETA after delivery", () => {
    expect(clientView({ ...base, status: "NOWE" })).toMatchObject({ plates: null, eta: null, progressPct: null, status: "przyjęte do realizacji" });
    expect(clientView({ ...base, status: "DO_ZAMKNIECIA" })).toMatchObject({ eta: null, progressPct: 100, status: "dostarczone" });
  });

  it("carries no field that could hold driver data", () => {
    const keys = Object.keys(clientView({ ...base, status: "W_DRODZE" }));
    expect(keys.some((k) => /driver|kierowc|phone|telefon|name/i.test(k))).toBe(false);
  });
});

describe("leaksDriverData", () => {
  const drivers = [{ firstName: "Krzysztof", lastName: "Szymański", phone: "+48 999 100 110" }];
  it("catches surnames, declined forms and phone numbers", () => {
    expect(leaksDriverData("Kierowca Szymański dojedzie ok. 14:00", drivers)).toBe(true);
    expect(leaksDriverData("Pan Szymańskiego proszę pytać", drivers)).toBe(true);
    expect(leaksDriverData("Telefon do kierowcy: 999-100-110", drivers)).toBe(true);
  });
  it("lets a clean draft through", () => {
    expect(leaksDriverData("Auto WB 6P77 jest w drodze, ETA 14:20.", drivers)).toBe(false);
  });
});
