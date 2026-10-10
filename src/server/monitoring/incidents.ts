import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { incidents, vehicleStates, type AlertAction, type IncidentKind } from "@/db/schema";
import { getRouteByKey, hasRouteKey } from "@/adapters/routing/static-routes";
import { formatTime } from "@/lib/format";
import { haversineM, nearestProgressS, positionAt } from "@/simulation/geo";
import { advance, predictArrival, type SimState } from "@/simulation/vehicle-sim";
import { raiseAlert } from "../alerts/raise";
import { resolveAlerts } from "../alerts/repository";
import { registerEventHandler, type TickContext } from "../tick/registry";
import { buildEnv, type IncidentRow, type VehicleRow } from "./env";
import { loadFleet, type FleetData } from "./fleet-data";
import { stopsForVehicle, toSimState } from "./state";

export type IncidentPayload = {
  id: string;
  kind: IncidentKind;
  title: string;
  description?: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
  speedFactor?: number;
  durationMin?: number;
  vehicleId?: string;
  extraMinutes?: number;
  alternativeRouteKey?: string;
};

const MIN = 60_000;

function simStateOf(fleet: FleetData, vehicle: VehicleRow, atMs: number): SimState | null {
  const row = fleet.states.get(vehicle.id);
  if (!row) return null;
  const stops = stopsForVehicle(fleet.openOrders.filter((o) => o.vehicleId === vehicle.id), fleet.points);
  return toSimState(row, stops, atMs);
}

/** Does the vehicle's remaining route pass through the incident area? */
function routeCrosses(sim: SimState, incident: IncidentRow): boolean {
  if (!sim.routeKey || sim.mode === "idle" || incident.lat === null || incident.lng === null || !incident.radiusM) return false;
  const route = getRouteByKey(sim.routeKey);
  return route.points.some((p) => p[3] > sim.progressS && haversineM(p[0], p[1], incident.lng!, incident.lat!) <= incident.radiusM!);
}

/** The order (and its delivery stop) the vehicle is currently heading for. */
function deliveryTarget(sim: SimState) {
  return sim.stops.find((s) => s.purpose === "delivery");
}

async function trafficAlerts(ctx: TickContext, fleet: FleetData, incident: IncidentRow) {
  for (const vehicle of fleet.vehicles) {
    const stale = simStateOf(fleet, vehicle, ctx.previousSim.getTime());
    if (!stale) continue;
    // Bring the vehicle to the moment of the incident before predicting.
    const sim = advance(stale, ctx.simNow.getTime(), buildEnv(vehicle, fleet), { reportEveryS: 10 ** 9 }).state;
    if (!routeCrosses(sim, incident)) continue;
    const target = deliveryTarget(sim);
    if (!target) continue;
    const isTarget = (s: { orderId: string; purpose: string }) => s.orderId === target.orderId && s.purpose === "delivery";
    const withIncident = predictArrival(sim, buildEnv(vehicle, fleet), isTarget);
    const without = predictArrival(sim, buildEnv(vehicle, fleet, { ignoreIncidents: true }), isTarget);
    let alternative: { eta: number; routeKey: string } | null = null;
    const altKey = incident.alternativeRouteKey;
    if (altKey && hasRouteKey(altKey)) {
      const alt = getRouteByKey(altKey);
      const current = sim.routeKey ? getRouteByKey(sim.routeKey) : null;
      if (current && alt.to === current.to) {
        const here = positionAt(current, sim.progressS);
        const altSim: SimState = { ...sim, routeKey: altKey, progressS: nearestProgressS(alt, here.lng, here.lat) };
        const prediction = predictArrival(altSim, buildEnv(vehicle, fleet), isTarget);
        if (prediction) alternative = { eta: prediction.arrivalMs, routeKey: altKey };
      }
    }
    const order = fleet.openOrders.find((o) => o.id === target.orderId);
    const trailer = fleet.trailerByVehicle.get(vehicle.id);
    const plates = [vehicle.plates, trailer?.plates].filter(Boolean).join(" + ");
    const delayMin = withIncident && without ? Math.round((withIncident.arrivalMs - without.arrivalMs) / MIN) : null;
    const facts = {
      summary: `${incident.title} · ${plates}`,
      zdarzenie: incident.title,
      opis: incident.description,
      pojazd: plates,
      zlecenie: order?.number ?? null,
      opoznienie_min: delayMin,
      eta_przez_zdarzenie: withIncident ? formatTime(withIncident.arrivalMs) : null,
      eta_bez_zdarzenia: without ? formatTime(without.arrivalMs) : null,
      okno_do: formatTime(target.windowToMs),
      objazd: alternative ? { trasa: "objazd przez Kostrzyn nad Odrą", eta: formatTime(alternative.eta) } : null,
    };
    const actions: AlertAction[] = alternative ? ["pokaz_objazd", "zastosuj_objazd", "powiadom_klienta"] : ["powiadom_klienta", "napisz_do_kierowcy"];
    await raiseAlert(
      ctx,
      {
        kind: "incident",
        severity: "warning",
        dedupeKey: `incident:${incident.id}:${vehicle.id}`,
        title: `${incident.title} — ${plates} na trasie`,
        body:
          `Spowolnienie ok. ${delayMin ?? "?"} min, ETA ${facts.eta_przez_zdarzenie ?? "?"} (okno do ${facts.okno_do}).` +
          (alternative ? ` Objazd przez Kostrzyn: ETA ${facts.objazd!.eta}.` : ""),
        actions,
        facts,
        vehicleId: vehicle.id,
        orderId: order?.id ?? null,
        driverId: order?.driverId ?? null,
        incidentId: incident.id,
      },
      ctx.simNow,
      ["pokaz_objazd", "zastosuj_objazd", "powiadom_klienta", "napisz_do_kierowcy", "brak"],
    );
  }
}

async function vehicleIncidentAlert(ctx: TickContext, fleet: FleetData, incident: IncidentRow) {
  const vehicle = fleet.vehicles.find((v) => v.id === incident.vehicleId);
  if (!vehicle) return;
  const state = fleet.states.get(vehicle.id);
  const order = fleet.openOrders.find((o) => o.id === state?.orderId) ?? fleet.openOrders.find((o) => o.vehicleId === vehicle.id);
  const trailer = fleet.trailerByVehicle.get(vehicle.id);
  const plates = [vehicle.plates, trailer?.plates].filter(Boolean).join(" + ");
  const facts = {
    summary: `${incident.title} · ${plates}`,
    zdarzenie: incident.title,
    opis: incident.description,
    pojazd: plates,
    zlecenie: order?.number ?? null,
    postoj_min: incident.extraMinutes,
    okno_rozladunku_do: order ? formatTime(order.deliveryTo) : null,
  };
  await raiseAlert(
    ctx,
    {
      kind: incident.kind,
      severity: "warning",
      dedupeKey: `incident:${incident.id}`,
      title: `${plates}: ${incident.title}`,
      body: `${incident.description} Dodatkowy postój ok. ${incident.extraMinutes} min${order ? ` (zlecenie ${order.number})` : ""}.`,
      actions: ["napisz_do_kierowcy", "powiadom_klienta"],
      facts,
      vehicleId: vehicle.id,
      orderId: order?.id ?? null,
      driverId: order?.driverId ?? null,
      incidentId: incident.id,
    },
    ctx.simNow,
    ["napisz_do_kierowcy", "powiadom_klienta", "przydziel_innego", "brak"],
  );
}

/** Scenario event: a road incident starts. */
export async function startIncident(ctx: TickContext, payload: IncidentPayload) {
  const start = ctx.simNow;
  const durationMin = payload.durationMin ?? payload.extraMinutes ?? 0;
  const id = `${payload.id}-${randomUUID().slice(0, 8)}`;
  const row = {
    sandboxId: ctx.sandbox.id,
    id,
    kind: payload.kind,
    title: payload.title,
    description: payload.description ?? "",
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    radiusM: payload.radiusM ?? null,
    speedFactor: payload.speedFactor ?? null,
    vehicleId: payload.vehicleId ?? null,
    extraMinutes: payload.extraMinutes ?? null,
    alternativeRouteKey: payload.alternativeRouteKey ?? null,
    startSim: start,
    endSim: payload.kind === "ramp_wait" ? null : new Date(start.getTime() + durationMin * MIN),
  };
  await ctx.tx.insert(incidents).values(row);

  if (payload.kind === "ramp_wait" && payload.vehicleId) {
    const extra = payload.extraMinutes ?? 0;
    // Already loading: stretch the loading; otherwise apply it when loading starts.
    await ctx.tx
      .update(vehicleStates)
      .set({
        modeUntil: sql`case when ${vehicleStates.mode} in ('handling', 'waiting') then ${vehicleStates.modeUntil} + make_interval(mins => ${extra}) else ${vehicleStates.modeUntil} end`,
        pendingExtraMin: sql`case when ${vehicleStates.mode} in ('handling', 'waiting') then ${vehicleStates.pendingExtraMin} else ${vehicleStates.pendingExtraMin} + ${extra} end`,
      })
      .where(and(eq(vehicleStates.sandboxId, ctx.sandbox.id), eq(vehicleStates.vehicleId, payload.vehicleId)));
  }

  const fleet = await loadFleet(ctx.tx, ctx.sandbox.id);
  const incident = fleet.incidents.find((i) => i.id === id)!;
  if (payload.kind === "traffic_accident") {
    await trafficAlerts(ctx, fleet, incident);
    await ctx.schedule({ dueSim: row.endSim!, type: "incident.end", payload: { incidentId: id } });
  } else {
    await vehicleIncidentAlert(ctx, fleet, incident);
  }
}

registerEventHandler("incident.start", (ctx, event) => startIncident(ctx, event.payload as unknown as IncidentPayload));
registerEventHandler("incident.end", async (ctx, event) => {
  await resolveAlerts(ctx.tx, ctx.sandbox.id, `incident:${String(event.payload.incidentId)}`, ctx.simNow);
});
