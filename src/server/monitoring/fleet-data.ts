import { and, eq, isNull, notInArray } from "drizzle-orm";
import {
  clients,
  couplings,
  drivers,
  incidents,
  orders,
  points,
  trailers,
  vehicles,
  vehicleStates,
} from "@/db/schema";
import type { Executor } from "@/db/types";
import { registerPointCoords } from "@/adapters/routing/static-routes";
import type { FleetEnvData, IncidentRow, PointRow, VehicleRow } from "./env";
import type { OrderRow, VehicleStateRow } from "./state";

export type DriverRow = typeof drivers.$inferSelect;
export type TrailerRow = typeof trailers.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

export type FleetData = FleetEnvData & {
  vehicles: VehicleRow[];
  states: Map<string, VehicleStateRow>;
  drivers: Map<string, DriverRow>;
  driverByVehicle: Map<string, DriverRow>;
  trailerByVehicle: Map<string, TrailerRow>;
  clients: Map<string, ClientRow>;
  /** Orders that are not finished (everything except ZAMKNIETE and ANULOWANE). */
  openOrders: OrderRow[];
};

export async function loadFleet(db: Executor, sandboxId: string): Promise<FleetData> {
  const [pointRows, vehicleRows, stateRows, driverRows, trailerRows, couplingRows, clientRows, orderRows, incidentRows] =
    await Promise.all([
      db.select().from(points).where(eq(points.sandboxId, sandboxId)),
      db.select().from(vehicles).where(eq(vehicles.sandboxId, sandboxId)),
      db.select().from(vehicleStates).where(eq(vehicleStates.sandboxId, sandboxId)),
      db.select().from(drivers).where(eq(drivers.sandboxId, sandboxId)),
      db.select().from(trailers).where(eq(trailers.sandboxId, sandboxId)),
      db.select().from(couplings).where(and(eq(couplings.sandboxId, sandboxId), isNull(couplings.toSim))),
      db.select().from(clients).where(eq(clients.sandboxId, sandboxId)),
      db
        .select()
        .from(orders)
        .where(and(eq(orders.sandboxId, sandboxId), notInArray(orders.status, ["ZAMKNIETE", "ANULOWANE"]))),
      db.select().from(incidents).where(eq(incidents.sandboxId, sandboxId)),
    ]);
  registerPointCoords(pointRows);
  const trailerById = new Map(trailerRows.map((t) => [t.id, t]));
  const driverByVehicle = new Map<string, DriverRow>();
  for (const d of driverRows) if (d.vehicleId) driverByVehicle.set(d.vehicleId, d);
  return {
    points: new Map<string, PointRow>(pointRows.map((p) => [p.id, p])),
    incidents: incidentRows as IncidentRow[],
    vehicles: vehicleRows.sort((a, b) => a.plates.localeCompare(b.plates)),
    states: new Map(stateRows.map((s) => [s.vehicleId, s])),
    drivers: new Map(driverRows.map((d) => [d.id, d])),
    driverByVehicle,
    trailerByVehicle: new Map(
      couplingRows.filter((c) => trailerById.has(c.trailerId)).map((c) => [c.vehicleId, trailerById.get(c.trailerId)!]),
    ),
    clients: new Map(clientRows.map((c) => [c.id, c])),
    openOrders: orderRows,
  };
}
