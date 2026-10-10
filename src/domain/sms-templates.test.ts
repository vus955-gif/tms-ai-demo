import { describe, expect, it } from "vitest";
import { cancellationSms, orderSms, reminderSms, windowText } from "./sms-templates";

const pickup = {
  name: "Logistyka Wisła — magazyn Gądki",
  address: "ul. Magazynowa 3",
  city: "Gądki",
  country: "PL",
  requirements: "Awizacja telefoniczna 2 h przed przyjazdem",
  notes: "Wjazd bramą nr 2",
};
const delivery = { name: "Odbiorca Leipzig", address: "Am GVZ 7", city: "Leipzig", country: "DE", requirements: "", notes: "" };
const order = {
  number: "ZL-1043",
  pickupFrom: new Date("2026-10-15T05:00:00Z"),
  pickupTo: new Date("2026-10-15T07:00:00Z"),
  deliveryFrom: new Date("2026-10-15T11:00:00Z"),
  deliveryTo: new Date("2026-10-15T13:00:00Z"),
  cargoPallets: 12,
  cargoKg: 4800,
  bodyRequired: null,
  adrRequired: false,
  references: ["LW-5501"],
  notes: "",
};

describe("SMS templates", () => {
  it("copies addresses, windows, remarks and references verbatim", () => {
    const sms = orderSms(order, "Logistyka Wisła Sp. z o.o.", pickup, delivery);
    expect(sms).toContain("ZLECENIE ZL-1043 · Logistyka Wisła Sp. z o.o.");
    expect(sms).toContain("ZAŁADUNEK: cz 15.10 07:00–09:00");
    expect(sms).toContain("Logistyka Wisła — magazyn Gądki, ul. Magazynowa 3, Gądki (PL)");
    expect(sms).toContain("Uwagi: Awizacja telefoniczna 2 h przed przyjazdem. Wjazd bramą nr 2");
    expect(sms).toContain("ROZŁADUNEK: cz 15.10 13:00–15:00");
    expect(sms).toContain("Ładunek: 12 palet, 4800 kg");
    expect(sms).toContain("Ref: LW-5501");
    expect(sms.trim().endsWith("Potwierdź odpisując OK.")).toBe(true);
  });

  it("marks ADR and reefer loads", () => {
    const sms = orderSms({ ...order, adrRequired: true, bodyRequired: "chlodnia" }, "X", pickup, delivery);
    expect(sms).toContain("Ładunek: 12 palet, 4800 kg, chłodnia, ADR");
  });

  it("shows both dates for windows over midnight", () => {
    expect(windowText(new Date("2026-10-15T20:00:00Z"), new Date("2026-10-16T04:00:00Z"))).toBe("cz 15.10 22:00 – pt 16.10 06:00");
  });

  it("writes reminders and cancellations", () => {
    expect(reminderSms(order)).toContain("potwierdź zlecenie ZL-1043");
    expect(cancellationSms(order)).toBe("Zlecenie ZL-1043 zostało odwołane. Nie jedź na załadunek. W razie pytań zadzwoń do spedycji.");
  });
});
