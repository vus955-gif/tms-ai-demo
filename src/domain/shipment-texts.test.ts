import { describe, expect, it } from "vitest";
import { agentStatusReplyText, trueTimes } from "@/simulation/bots/shipment-agent-replies";
import { agentStatusRequest, clientUpdateTemplate, formatShipmentDate, leaksAgentData, parseShipmentTime, readStatusByRules } from "./shipment-texts";
import { planMilestones } from "./shipments";

const H = 3_600_000;
const D = 24 * H;
const etd = Date.UTC(2026, 8, 20, 10); // 20.09.2026 12:00 Warsaw
const eta = etd + 34 * D;
const plan = planMilestones("sea", etd, eta, { origin: "Szanghaj", destination: "Gdańsk (DCT)", middle: { name: "Rotterdam", fraction: 0.88 } });
const truth = { departureDelayH: 20, middleDelayH: 30, arrivalDelayH: 0, reason: "kongestia w porcie Rotterdam", reasonEn: "port congestion in Rotterdam" };

describe("shipment texts", () => {
  it("reads a time without a zone as Warsaw time, whatever the server's zone", () => {
    expect(parseShipmentTime("2026-10-21T08:00")).toBe(Date.UTC(2026, 9, 21, 6));
    expect(parseShipmentTime("2026-11-02T08:00")).toBe(Date.UTC(2026, 10, 2, 7));
    expect(parseShipmentTime("2026-10-21T08:00:00Z")).toBe(Date.UTC(2026, 9, 21, 8));
    expect(parseShipmentTime("2026-10-21T08:00+02:00")).toBe(Date.UTC(2026, 9, 21, 6));
    expect(parseShipmentTime("jutro rano")).toBeNaN();
  });

  it("asks the agent with shipment numbers only, never the client's reference", () => {
    const r = agentStatusRequest({ number: "MOR-1001", mode: "sea", route: "Szanghaj → Gdańsk", refs: { bl: "DEMO-BL-1", container: "DEMU1234567", clientRef: "MZ-PO-77" }, language: "pl", signature: "TransDemo" });
    expect(r.subject).toBe("Prośba o status MOR-1001");
    expect(r.body).toContain("Kontener: DEMU1234567");
    expect(r.body).not.toContain("MZ-PO-77");
  });

  it("reads what the demo agent reports, in Polish and in English", () => {
    // 33 days in: the transshipment (planned day 29.9, plus 50 h of delay) has happened, arrival not yet.
    const now = etd + 33 * D;
    for (const language of ["pl", "en"] as const) {
      const text = agentStatusReplyText({ language, mode: "sea", number: "MOR-1001", contactName: "Karolina Nowicka", milestones: plan, truth, nowMs: now });
      const read = readStatusByRules(text);
      const real = trueTimes(plan, truth);
      expect(read.events.find((e) => e.kind === "departed")?.atMs).toBe(Math.floor(real.get("departed")! / 60_000) * 60_000);
      expect(read.events.find((e) => e.kind === "transshipment")?.atMs).toBe(Math.floor(real.get("transshipment")! / 60_000) * 60_000);
      expect(read.etaMs).toBe(Math.floor(real.get("arrived")! / 60_000) * 60_000);
      expect(read.delayReason).toBe(language === "pl" ? "kongestia w porcie Rotterdam" : "port congestion in Rotterdam");
      expect(read.confidence).toBeGreaterThan(0.5);
    }
  });

  it("reports nothing in particular before departure, and the rules say so with low confidence", () => {
    const text = agentStatusReplyText({ language: "pl", mode: "sea", number: "MOR-1001", contactName: "X", milestones: plan, truth, nowMs: etd - 5 * D });
    expect(text).toContain("booking potwierdzony");
    expect(readStatusByRules("Dzień dobry, wszystko zgodnie z planem.").confidence).toBeLessThan(0.5);
  });

  it("writes the client update from facts and blocks agent names and money", () => {
    const t = clientUpdateTemplate({
      number: "MOR-1001",
      clientRef: "MZ-PO-77",
      modeLabel: "morskiej",
      route: "Szanghaj → Gdańsk (DCT)",
      destination: "Gdańsk (DCT)",
      refs: "Kontener: DEMU1234567",
      last: { label: "Przeładunek", location: "Rotterdam", atMs: etd + 31 * D },
      next: null,
      etaMs: eta + 50 * H,
      delayHours: 50,
      delayReason: "kongestia w porcie Rotterdam",
      recipientName: "Robert Pawlak",
      signature: "TransDemo",
    });
    expect(t.body).toContain(`Przewidywane dotarcie do Gdańsk (DCT): ${formatShipmentDate(eta + 50 * H)} (opóźnienie ok. 2 dni — kongestia w porcie Rotterdam).`);
    const agentsList = [{ company: "Baltic Ocean Lines Agency", contactName: "Karolina Nowicka", email: "rates@baltic-ocean.example" }];
    expect(leaksAgentData(t.body, agentsList)).toBe(false);
    expect(leaksAgentData(`${t.body}\nNasz agent Baltic Ocean Lines potwierdził.`, agentsList)).toBe(true);
    expect(leaksAgentData(`${t.body}\nKontakt: pani Nowicka.`, agentsList)).toBe(true);
    expect(leaksAgentData(`${t.body}\nKoszt postoju 450 EUR.`, agentsList)).toBe(true);
    expect(leaksAgentData(`${t.body}\nInformacja od pani Nowickiej.`, agentsList)).toBe(true);
    expect(leaksAgentData(`${t.body}\nDopłata 120 €.`, agentsList)).toBe(true);
    // Agent names that are also places or trade words are not leaks on their own.
    const all = [
      ...agentsList,
      { company: "Gdańsk Cargo Partners", contactName: "Michał Lis", email: "oferty@gdansk-cargo.example" },
      { company: "Warsaw Air Cargo Services", contactName: "Agnieszka Kurek", email: "cargo@waw-aircargo.example" },
      { company: "MultiModal Partners", contactName: "Tomasz Wrona", email: "rfq@multimodal.example" },
    ];
    expect(leaksAgentData(`${t.body}\nPrzesyłka multimodalna, air cargo przez Warszawę, rozładunek w Gdańsku.`, all)).toBe(false);
    expect(leaksAgentData(`${t.body}\nKontakt: oferty@gdansk-cargo.example`, all)).toBe(true);
    // …but the name itself, made only of such words, is.
    expect(leaksAgentData(`${t.body}\nTransport przez Gdańsk Cargo Partners.`, all)).toBe(true);
    expect(leaksAgentData(`${t.body}\nNasz partner Warsaw Air Cargo potwierdził.`, all)).toBe(true);
    // Money in the forms people write it; a pallet type is not money.
    for (const money of ["Dopłata 450 zł.", "Koszt EUR 450.", "Postój 1 200 złotych.", "Razem 450 euro.", "Opłata USD1200."]) {
      expect(leaksAgentData(`${t.body}\n${money}`, agentsList), money).toBe(true);
    }
    expect(leaksAgentData(`${t.body}\nTowar na 33 EUR-paletach.`, agentsList)).toBe(false);
  });
});
