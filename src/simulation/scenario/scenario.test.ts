import { describe, expect, it } from "vitest";
import { scenario } from ".";

const ids = <T extends { id: string }>(items: T[]) => new Set(items.map((i) => i.id));
const unique = (values: string[]) => new Set(values).size === values.length;

describe("scenario data", () => {
  const pointIds = ids(scenario.points);
  const clientIds = ids(scenario.clients);
  const vehicleIds = ids(scenario.vehicles);
  const trailerIds = ids(scenario.trailers);
  const driverIds = ids(scenario.drivers);

  it("matches the counts from the spec", () => {
    expect(scenario.points).toHaveLength(24);
    expect(scenario.points.filter((p) => p.kind === "base").map((p) => p.city)).toEqual([
      "Komorniki",
      "Stryków",
      "Bielany Wrocławskie",
    ]);
    expect(scenario.clients).toHaveLength(8);
    expect(scenario.clients.filter((c) => c.isKey)).toHaveLength(3);
    expect(scenario.vehicles).toHaveLength(14);
    expect(scenario.vehicles.filter((v) => v.kind === "bus")).toHaveLength(5);
    expect(scenario.vehicles.filter((v) => v.kind === "bus" && v.international)).toHaveLength(2);
    expect(scenario.vehicles.filter((v) => v.kind === "tractor")).toHaveLength(9);
    expect(scenario.trailers).toHaveLength(11);
    expect(scenario.trailers.filter((t) => t.body === "chlodnia")).toHaveLength(1);
    expect(scenario.trailers.filter((t) => t.adr)).toHaveLength(1);
    expect(scenario.couplings).toHaveLength(9);
    expect(scenario.drivers).toHaveLength(14);
    expect(scenario.drivers.filter((d) => d.adrCertificate)).toHaveLength(2);
    expect(scenario.orders).toHaveLength(11);
    expect(scenario.idleVehicles).toHaveLength(3);
  });

  it("uses unique ids, plates and phone numbers", () => {
    for (const list of [scenario.points, scenario.clients, scenario.contacts, scenario.vehicles, scenario.trailers, scenario.drivers, scenario.orders]) {
      expect(unique(list.map((i) => i.id))).toBe(true);
    }
    expect(unique([...scenario.vehicles.map((v) => v.plates), ...scenario.trailers.map((t) => t.plates)])).toBe(true);
    expect(unique(scenario.drivers.map((d) => d.phone))).toBe(true);
    expect(unique(scenario.orders.map((o) => o.number))).toBe(true);
  });

  it("only references existing entities", () => {
    for (const p of scenario.points) if (p.clientId) expect(clientIds).toContain(p.clientId);
    for (const c of scenario.contacts) expect(clientIds).toContain(c.clientId);
    for (const v of scenario.vehicles) expect(pointIds).toContain(v.homePointId);
    for (const c of scenario.couplings) {
      expect(vehicleIds).toContain(c.vehicleId);
      expect(trailerIds).toContain(c.trailerId);
    }
    for (const d of scenario.drivers) expect(vehicleIds).toContain(d.vehicleId);
    for (const a of scenario.activities) expect(driverIds).toContain(a.driverId);
    for (const h of scenario.history) {
      expect(driverIds).toContain(h.driverId);
      expect(clientIds).toContain(h.clientId);
    }
    for (const o of scenario.orders) {
      expect(clientIds).toContain(o.clientId);
      expect(driverIds).toContain(o.driverId);
      expect(vehicleIds).toContain(o.vehicleId);
      expect(pointIds).toContain(o.pickupPointId);
      expect(pointIds).toContain(o.deliveryPointId);
      if (o.start.stage === "to_pickup") expect(pointIds).toContain(o.start.fromPointId);
    }
  });

  it("uses each client's own points for its orders", () => {
    const owner = new Map(scenario.points.map((p) => [p.id, p.clientId]));
    for (const o of scenario.orders) {
      expect(owner.get(o.pickupPointId)).toBe(o.clientId);
      expect(owner.get(o.deliveryPointId)).toBe(o.clientId);
    }
  });

  it("gives every vehicle a driver and exactly one place at start", () => {
    const driven = new Set(scenario.drivers.map((d) => d.vehicleId));
    expect(driven.size).toBe(14);
    const busy = scenario.orders.map((o) => o.vehicleId);
    const idle = scenario.idleVehicles.map((v) => v.vehicleId);
    expect(unique([...busy, ...idle])).toBe(true);
    expect(new Set([...busy, ...idle]).size).toBe(14);
  });

  it("keeps each order consistent with the driver's vehicle and the cargo limits", () => {
    const vehicleOf = new Map(scenario.drivers.map((d) => [d.id, d.vehicleId]));
    const trailerOf = new Map(scenario.couplings.map((c) => [c.vehicleId, c.trailerId]));
    for (const o of scenario.orders) {
      expect(vehicleOf.get(o.driverId)).toBe(o.vehicleId);
      const vehicle = scenario.vehicles.find((v) => v.id === o.vehicleId)!;
      const trailer = scenario.trailers.find((t) => t.id === trailerOf.get(vehicle.id));
      const pallets = trailer?.capacityPallets ?? vehicle.capacityPallets;
      const kg = trailer?.capacityKg ?? vehicle.capacityKg;
      expect(o.cargoPallets).toBeLessThanOrEqual(pallets);
      expect(o.cargoKg).toBeLessThanOrEqual(kg);
      if (o.bodyRequired) expect(trailer?.body ?? vehicle.body).toBe(o.bodyRequired);
      if (o.adrRequired) {
        expect(trailer?.adr || vehicle.adr).toBe(true);
        expect(scenario.drivers.find((d) => d.id === o.driverId)!.adrCertificate).toBe(true);
      }
      expect(o.pickupFromMin).toBeLessThan(o.pickupToMin);
      expect(o.deliveryFromMin).toBeLessThan(o.deliveryToMin);
      expect(o.start.progress).toBeGreaterThanOrEqual(0);
      expect(o.start.progress).toBeLessThan(1);
    }
  });

  it("gives each driver contiguous activities ending in exactly one ongoing one", () => {
    for (const d of scenario.drivers) {
      const list = scenario.activities.filter((a) => a.driverId === d.id).sort((a, b) => a.startMin - b.startMin);
      expect(list.length).toBeGreaterThan(0);
      expect(list.filter((a) => a.endMin === null)).toHaveLength(1);
      expect(list.at(-1)!.endMin).toBeNull();
      for (let i = 1; i < list.length; i++) expect(list[i].startMin).toBe(list[i - 1].endMin);
      expect(list.at(-1)!.startMin).toBeLessThanOrEqual(0);
    }
  });

  it("covers Poland, Germany and Czechia", () => {
    expect(new Set(scenario.points.map((p) => p.country))).toEqual(new Set(["PL", "DE", "CZ"]));
  });
});
