import { and, eq } from "drizzle-orm";
import { orders, type AlertAction } from "@/db/schema";
import { evaluateRisk, RISK_REASON_LABEL, type RiskResult } from "@/domain/risk";
import { formatHm, formatTime } from "@/lib/format";
import { predictArrival, type Prediction, type SimState } from "@/simulation/vehicle-sim";
import { raiseAlert } from "../alerts/raise";
import { resolveAlerts } from "../alerts/repository";
import { registerTickPhase, type TickContext } from "../tick/registry";
import { buildEnv } from "./env";
import { FLEET_CACHE, SIM_STATES_CACHE } from "./movement";
import type { FleetData } from "./fleet-data";
import { routeLabel } from "./labels";
import type { OrderRow } from "./state";

export const RISK_CACHE = "risk";

export type OrderRisk = { orderId: string; vehicleId: string; risk: RiskResult; delivery: Prediction | null };

/** Facts AI may use to explain a risk alert (all numbers computed here, never by AI). */
export function riskFacts(fleet: FleetData, order: OrderRow, risk: RiskResult, delivery: Prediction | null) {
  const vehicle = fleet.vehicles.find((v) => v.id === order.vehicleId);
  const trailer = vehicle ? fleet.trailerByVehicle.get(vehicle.id) : undefined;
  const driver = order.driverId ? fleet.drivers.get(order.driverId) : undefined;
  const plates = [vehicle?.plates, trailer?.plates].filter(Boolean).join(" + ");
  return {
    summary: `${plates} · ${order.number}`,
    pojazd: plates,
    kierowca: driver ? `${driver.firstName} ${driver.lastName}` : null,
    zlecenie: order.number,
    klient: fleet.clients.get(order.clientId)?.name ?? null,
    trasa: routeLabel(fleet, order),
    stan: risk.state,
    powody: risk.reasons.map((r) => RISK_REASON_LABEL[r]),
    eta_rozladunek: delivery ? formatTime(delivery.arrivalMs) : null,
    okno_rozladunku_do: formatTime(order.deliveryTo),
    zapas_min: risk.bufferMin === null ? null : Math.round(risk.bufferMin),
    jazda_do_celu: delivery ? formatHm(delivery.drivingMin) : null,
    przerwy_po_drodze: delivery?.breaks ?? null,
    odpoczynek_dobowy_po_drodze: delivery?.restRequired ?? null,
    przerwa_za_min_jazdy: delivery?.firstBreakAfterDrivingMin === null || !delivery ? null : Math.round(delivery.firstBreakAfterDrivingMin),
  };
}

function riskTemplate(facts: ReturnType<typeof riskFacts>, risk: RiskResult) {
  const reason = facts.powody[0] ?? "zagrożony termin";
  if (risk.state === "red") {
    const late = facts.zapas_min !== null && facts.zapas_min < 0 ? ` Spóźnienie ok. ${Math.abs(facts.zapas_min)} min.` : "";
    return {
      title: `${facts.pojazd}: ${reason}`,
      body: `${facts.zlecenie} (${facts.trasa}). ETA ${facts.eta_rozladunek ?? "?"}, okno do ${facts.okno_rozladunku_do}.${late}`,
      actions: ["powiadom_klienta", "napisz_do_kierowcy"] as AlertAction[],
    };
  }
  return {
    title: `${facts.pojazd}: ${reason}`,
    body: `${facts.zlecenie} (${facts.trasa}) zdąży w oknie do ${facts.okno_rozladunku_do}. ETA po przerwie ${facts.eta_rozladunek ?? "?"}.`,
    actions: ["brak"] as AlertAction[],
  };
}

/** Tick phase: predicts every moving order, stores ETA and risk, opens and resolves risk alerts. */
export async function riskPhase(ctx: TickContext) {
  const fleet = ctx.cache.get(FLEET_CACHE) as FleetData | undefined;
  const simStates = ctx.cache.get(SIM_STATES_CACHE) as Map<string, SimState> | undefined;
  if (!fleet || !simStates) return;
  const results: OrderRisk[] = [];
  const sid = ctx.sandbox.id;

  for (const order of fleet.openOrders) {
    if (!["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"].includes(order.status) || !order.vehicleId) {
      // Delivered or not moving any more: the risk question is settled.
      if (order.risk !== null) {
        await ctx.tx.update(orders).set({ risk: null }).where(and(eq(orders.sandboxId, sid), eq(orders.id, order.id)));
        await resolveAlerts(ctx.tx, sid, `risk:${order.id}:`, ctx.simNow);
      }
      continue;
    }
    const vehicle = fleet.vehicles.find((v) => v.id === order.vehicleId);
    const sim = simStates.get(order.vehicleId);
    if (!vehicle || !sim) continue;
    const env = buildEnv(vehicle, fleet);
    const delivery = predictArrival(sim, env, (s) => s.orderId === order.id && s.purpose === "delivery");
    const pickup =
      order.status === "POTWIERDZONE"
        ? { prediction: predictArrival(sim, env, (s) => s.orderId === order.id && s.purpose === "pickup"), toMs: order.pickupTo.getTime() }
        : undefined;
    const risk = evaluateRisk({ subjectTo561: vehicle.subjectTo561, delivery, deliveryToMs: order.deliveryTo.getTime(), pickup });
    results.push({ orderId: order.id, vehicleId: vehicle.id, risk, delivery });

    const etaPredicted = delivery ? new Date(delivery.arrivalMs) : null;
    const state = risk.state === "gray" ? null : risk.state;
    if (order.risk !== state || order.etaPredicted?.getTime() !== etaPredicted?.getTime()) {
      await ctx.tx.update(orders).set({ risk: state, etaPredicted }).where(and(eq(orders.sandboxId, sid), eq(orders.id, order.id)));
    }

    const prefix = `risk:${order.id}:`;
    if (risk.state === "green") {
      await resolveAlerts(ctx.tx, sid, prefix, ctx.simNow);
    } else if (risk.state === "red" || risk.state === "yellow") {
      const key = `${prefix}${risk.state}`;
      await resolveAlerts(ctx.tx, sid, prefix, ctx.simNow, key);
      const facts = riskFacts(fleet, order, risk, delivery);
      const text = riskTemplate(facts, risk);
      await raiseAlert(
        ctx,
        {
          kind: `risk_${risk.state}`,
          severity: risk.state === "red" ? "critical" : "info",
          dedupeKey: key,
          ...text,
          facts,
          vehicleId: vehicle.id,
          orderId: order.id,
          driverId: order.driverId,
        },
        ctx.simNow,
        risk.state === "red" ? ["powiadom_klienta", "napisz_do_kierowcy", "przydziel_innego"] : ["brak", "napisz_do_kierowcy"],
      );
    }
  }
  ctx.cache.set(RISK_CACHE, results);
}

registerTickPhase("risk", riskPhase);
