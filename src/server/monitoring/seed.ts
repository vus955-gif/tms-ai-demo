import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { driverActivities, points, scheduledEvents, vehicleStates } from "@/db/schema";
import type { Executor } from "@/db/types";
import { getRoute } from "@/adapters/routing/static-routes";
import { clockFromActivities } from "@/domain/driving-time";
import { positionAt } from "@/simulation/geo";
import { seedFromString } from "@/simulation/random";
import { scenario } from "@/simulation/scenario";
import { timeline } from "@/simulation/scenario/timeline";
import { registerSeedExtension, type SandboxRow } from "../sandbox/repository";
import { atMin } from "../sandbox/seed";

/** Places every vehicle where the scenario says it is at 08:30 and schedules the scripted events. */
export async function seedMonitoring(db: Executor, sandbox: SandboxRow) {
  const sandboxId = sandbox.id;
  const origin = sandbox.simOrigin;
  const startMs = origin.getTime();
  const pointRows = await db.select().from(points).where(eq(points.sandboxId, sandboxId));
  const pointById = new Map(pointRows.map((p) => [p.id, p]));
  const activityRows = await db.select().from(driverActivities).where(eq(driverActivities.sandboxId, sandboxId));
  const orderByVehicle = new Map(scenario.orders.map((o) => [o.vehicleId, o]));
  const idleAt = new Map(scenario.idleVehicles.map((v) => [v.vehicleId, v.pointId]));

  const rows = scenario.vehicles.map((vehicle) => {
    const driver = scenario.drivers.find((d) => d.vehicleId === vehicle.id)!;
    const own = activityRows.filter((a) => a.driverId === driver.id);
    const clock = clockFromActivities(
      own.map((a) => ({ type: a.type, startMs: a.startSim.getTime(), endMs: a.endSim?.getTime() ?? null })),
      startMs,
      driver.extensionsUsedThisWeek,
    );
    const open = own.find((a) => a.endSim === null);
    const order = orderByVehicle.get(vehicle.id);
    const phase = seedFromString(vehicle.id) % 150;
    const base = {
      sandboxId,
      vehicleId: vehicle.id,
      driverId: driver.id,
      continuousMin: clock.continuousMin,
      dailyMin: clock.dailyMin,
      splitFirstPart: clock.splitFirstPart,
      extensionsUsed: clock.extensionsUsed,
      reportPhaseS: phase,
      currentActivityId: open?.id ?? null,
      lastReportAt: origin,
    };
    if (!order) {
      const point = pointById.get(idleAt.get(vehicle.id)!)!;
      return { ...base, mode: "idle" as const, pointId: point.id, lastReportLng: point.lng, lastReportLat: point.lat, lastReportProgressS: 0 };
    }
    const [from, to, purpose] =
      order.start.stage === "to_pickup"
        ? [order.start.fromPointId, order.pickupPointId, "to_pickup" as const]
        : [order.pickupPointId, order.deliveryPointId, "to_delivery" as const];
    const route = getRoute(from, to);
    const progressS = route.durationS * order.start.progress;
    const at = positionAt(route, progressS);
    return {
      ...base,
      mode: "driving" as const,
      routeKey: route.key,
      progressS,
      legPurpose: purpose,
      orderId: order.id,
      lastReportLng: at.lng,
      lastReportLat: at.lat,
      lastReportProgressS: progressS,
    };
  });
  await db.insert(vehicleStates).values(rows);

  const events = timeline().map((entry) => ({
    sandboxId,
    id: randomUUID(),
    dueSim: atMin(origin, entry.atMin),
    type: entry.type,
    payload: entry.payload,
  }));
  if (events.length > 0) await db.insert(scheduledEvents).values(events);
}

registerSeedExtension(seedMonitoring);
