import { randomUUID } from "node:crypto";
import {
  clientContacts,
  clients,
  couplings,
  driverActivities,
  driverClientHistory,
  drivers,
  orders,
  orderStatusChanges,
  points,
  trailers,
  vehicles,
} from "@/db/schema";
import type { Executor } from "@/db/types";
import { scenario } from "@/simulation/scenario";

const MIN = 60_000;

/** Turns scenario-relative minutes into an absolute simulation time. */
export const atMin = (simOrigin: Date, minutes: number) => new Date(simOrigin.getTime() + minutes * MIN);

/** Copies the scenario into a fresh world. Later stages add plans and scheduled events. */
export async function seedScenario(db: Executor, sandboxId: string, simOrigin: Date): Promise<void> {
  const t = (m: number) => atMin(simOrigin, m);
  const idleAt = new Map(scenario.idleVehicles.map((v) => [v.vehicleId, v.pointId]));
  const trailerOf = new Map(scenario.couplings.map((c) => [c.vehicleId, c.trailerId]));
  const sid = { sandboxId };

  await db.insert(points).values(scenario.points.map((p) => ({ ...sid, ...p })));
  await db.insert(clients).values(scenario.clients.map((c) => ({ ...sid, ...c })));
  await db.insert(clientContacts).values(scenario.contacts.map((c) => ({ ...sid, ...c })));
  await db
    .insert(vehicles)
    .values(scenario.vehicles.map((v) => ({ ...sid, ...v, currentPointId: idleAt.get(v.id) ?? null })));
  await db.insert(trailers).values(
    scenario.trailers.map((tr) => ({
      ...sid,
      id: tr.id,
      plates: tr.plates,
      body: tr.body,
      capacityPallets: tr.capacityPallets,
      capacityKg: tr.capacityKg,
      adr: tr.adr,
    })),
  );
  await db.insert(couplings).values(
    scenario.couplings.map((c) => ({
      ...sid,
      id: `cp-${c.vehicleId}-${c.trailerId}`,
      vehicleId: c.vehicleId,
      trailerId: c.trailerId,
      fromSim: t(-30 * 24 * 60),
      toSim: null,
    })),
  );
  await db.insert(drivers).values(scenario.drivers.map((d) => ({ ...sid, ...d })));
  await db.insert(driverActivities).values(
    scenario.activities.map((a, i) => ({
      ...sid,
      id: `act-${a.driverId}-${i}`,
      driverId: a.driverId,
      type: a.type,
      startSim: t(a.startMin),
      endSim: a.endMin === null ? null : t(a.endMin),
      source: "seed" as const,
    })),
  );
  await db.insert(orders).values(
    scenario.orders.map((o) => ({
      ...sid,
      id: o.id,
      number: o.number,
      clientId: o.clientId,
      pickupPointId: o.pickupPointId,
      pickupFrom: t(o.pickupFromMin),
      pickupTo: t(o.pickupToMin),
      deliveryPointId: o.deliveryPointId,
      deliveryFrom: t(o.deliveryFromMin),
      deliveryTo: t(o.deliveryToMin),
      cargoPallets: o.cargoPallets,
      cargoKg: o.cargoKg,
      bodyRequired: o.bodyRequired,
      adrRequired: o.adrRequired,
      references: o.references,
      notes: o.notes,
      status: o.status,
      driverId: o.driverId,
      vehicleId: o.vehicleId,
      trailerId: trailerOf.get(o.vehicleId) ?? null,
      etd: t(o.pickupToMin),
      etaAgreed: t(o.deliveryToMin),
      source: "scenario" as const,
      createdSim: t(o.pickupFromMin - 24 * 60),
    })),
  );
  await db.insert(orderStatusChanges).values(
    scenario.orders.map((o) => ({
      ...sid,
      id: randomUUID(),
      orderId: o.id,
      fromStatus: null,
      toStatus: o.status,
      actor: "system" as const,
      reason: "Stan początkowy scenariusza",
      atSim: simOrigin,
    })),
  );
  await db.insert(driverClientHistory).values(scenario.history.map((h) => ({ ...sid, ...h })));
}
