import { describe, expect, it } from "vitest";
import { clientUpdateState, densifyPath, etaDelayHours, greatCirclePoint, nextAgentRequestMs, planMilestones, positionOnPath } from "./shipments";

const H = 3_600_000;
const D = 24 * H;
const etd = Date.UTC(2026, 9, 10, 12);
const eta = etd + 30 * D;

describe("shipments: plan, progress and rhythm", () => {
  it("plans the milestones of a sea shipment, with a transshipment at the right share of the voyage", () => {
    const plan = planMilestones("sea", etd, eta, { origin: "Szanghaj", destination: "Gdańsk", middle: { name: "Port Said", fraction: 0.6 } });
    expect(plan.map((m) => m.kind)).toEqual(["booking", "terminal_in", "departed", "transshipment", "arrived", "customs", "delivered"]);
    expect(plan.find((m) => m.kind === "transshipment")).toMatchObject({ location: "Port Said", plannedMs: etd + 18 * D, seq: 3 });
    expect(plan[0]).toMatchObject({ label: "Booking potwierdzony", location: "Szanghaj", plannedMs: etd - 10 * D });
    expect(plan.at(-1)).toMatchObject({ location: "Gdańsk", plannedMs: eta + 3 * D });
  });

  it("calls the middle stop of a rail shipment a border crossing", () => {
    const plan = planMilestones("rail", etd, etd + 16 * D, { origin: "Xi'an", destination: "Łódź", middle: { name: "Małaszewicze", fraction: 0.8 } });
    expect(plan.find((m) => m.kind === "border")).toMatchObject({ label: "Przejście graniczne", location: "Małaszewicze" });
  });

  it("draws lanes as arcs and finds points along them", () => {
    // Warsaw → Chicago flies over the North Atlantic, north of both cities.
    const mid = greatCirclePoint([20.97, 52.17], [-87.9, 41.98], 0.5);
    expect(mid[1]).toBeGreaterThan(55);
    const path = densifyPath([[20.97, 52.17], [-87.9, 41.98]]);
    expect(path.length).toBeGreaterThan(40);
    expect(positionOnPath(path, 0)).toEqual(path[0]);
    expect(positionOnPath(path, 1)).toEqual(path.at(-1));
  });

  it("asks the agent on rhythm, or sooner when a planned milestone passes without news", () => {
    const now = etd + 5 * H;
    const plan = [{ plannedMs: etd, actualMs: null }];
    // Departure was due 5 h ago, no news: ask now (2 h grace), not in 48 h.
    expect(nextAgentRequestMs(48, now - 10 * H, plan, now)).toBe(etd + 2 * H);
    // Departure confirmed: the regular 48 h rhythm.
    expect(nextAgentRequestMs(48, now - 10 * H, [{ plannedMs: etd, actualMs: etd }], now)).toBe(now - 10 * H + 48 * H);
    // Asked 1 h ago about the overdue departure: ask again after half the rhythm (6 h for air), not every 4 h.
    expect(nextAgentRequestMs(12, now - H, plan, now)).toBe(now + 5 * H);
    // A later milestone is confirmed: the one the agent skipped is not chased.
    const skipped = [
      { kind: "departed" as const, seq: 2, plannedMs: etd, actualMs: null },
      { kind: "arrived" as const, seq: 3, plannedMs: etd + 2 * H, actualMs: etd + 3 * H },
    ];
    expect(nextAgentRequestMs(48, now - 10 * H, skipped, now)).toBe(now - 10 * H + 48 * H);
    // The agent reported 52 h of delay: arrival is not overdue at its old planned time.
    const late = [{ kind: "arrived" as const, seq: 3, plannedMs: etd, actualMs: null }];
    expect(nextAgentRequestMs(48, now - 10 * H, late, now, 52 * H)).toBe(now - 10 * H + 48 * H);
    // …and it becomes overdue 2 h after the reported ETA.
    expect(nextAgentRequestMs(48, etd + 50 * H, late, etd + 60 * H, 52 * H)).toBe(etd + 54 * H);
  });

  it("tells when a client update is due soon or late", () => {
    expect(clientUpdateState(null, 0)).toBe("ok");
    expect(clientUpdateState(10 * H, 7 * H)).toBe("ok");
    expect(clientUpdateState(10 * H, 9 * H)).toBe("wkrotce");
    expect(clientUpdateState(10 * H, 10 * H)).toBe("po_terminie");
    expect(etaDelayHours(eta, eta + 50 * H)).toBe(50);
  });
});
