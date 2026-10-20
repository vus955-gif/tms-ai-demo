import { describe, expect, it } from "vitest";
import { laneRegion, pickRfqAgents, regionOf, servesRegion } from "./agent-regions";

const agent = (id: string, regions: string, replyRate = 0.7) => ({ id, regions, replyRate });

describe("RFQ recipients by region", () => {
  it("takes the region from the foreign end of the lane", () => {
    expect(laneRegion("PL", "CN")).toBe("Azja");
    expect(laneRegion("US", "PL")).toBe("Ameryka Płn.");
    expect(laneRegion("DE", "PL")).toBe("Europa");
    expect(regionOf(null)).toBeNull();
  });

  it("reads agents' free-text regions, with or without Polish letters", () => {
    expect(servesRegion("Azja, Ameryka Płn.", "Ameryka Płn.")).toBe(true);
    expect(servesRegion("Chiny – Europa", "Azja")).toBe(true);
    expect(servesRegion("cały świat", "Afryka")).toBe(true);
    expect(servesRegion("Morze Śródziemne, Afryka Płn.", "Azja")).toBe(false);
  });

  it("asks up to five covering agents, the most responsive first", () => {
    const list = [agent("a", "Azja", 0.9), agent("b", "Azja", 0.5), agent("c", "cały świat", 0.6), agent("d", "Europa", 0.95), agent("e", "Chiny", 0.7), agent("f", "Azja", 0.8), agent("g", "Japonia", 0.4)];
    expect(pickRfqAgents(list, "Azja").map((a) => a.id)).toEqual(["a", "f", "e", "c", "b"]);
  });

  it("fills up to three when too few agents cover the region", () => {
    const list = [agent("a", "Azja", 0.9), agent("b", "Europa", 0.5), agent("c", "Europa", 0.8)];
    expect(pickRfqAgents(list, "Ameryka Płd.").map((a) => a.id)).toEqual(["a", "c", "b"]);
  });
});
