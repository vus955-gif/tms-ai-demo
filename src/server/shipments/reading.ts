import { and, asc, eq, ne } from "drizzle-orm";
import { alerts, messages, shipmentMilestones, shipments, type AlertSeverity } from "@/db/schema";
import type { Executor } from "@/db/types";
import { readShipmentStatus } from "@/ai/functions/shipments";
import { formatShipmentDate } from "@/domain/shipment-texts";
import { MODE_LABEL } from "@/domain/shipments";
import { placeById } from "@/simulation/scenario/shipment-places";
import { openAlert, resolveAlerts, type AlertInput } from "../alerts/repository";
import { setShipment, type MilestoneRow, type ShipmentRow } from "./gateway";

const H = 3_600_000;
const D = 24 * H;
/** An ETA that moves by this much is news for the forwarder and the client. */
export const ETA_CHANGE_ALERT_H = 12;
/** Below this a reading of the agent's mail is not applied (rules that found something report 0.6). */
export const MIN_CONFIDENCE = 0.5;

export async function loadShipment(db: Executor, sandboxId: string, id: string): Promise<ShipmentRow | undefined> {
  const [s] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.id, id)));
  return s;
}

export async function loadMilestones(db: Executor, sandboxId: string, shipmentId: string): Promise<MilestoneRow[]> {
  return db
    .select()
    .from(shipmentMilestones)
    .where(and(eq(shipmentMilestones.sandboxId, sandboxId), eq(shipmentMilestones.shipmentId, shipmentId)))
    .orderBy(asc(shipmentMilestones.seq));
}

/** Opens an alert only once per key: a dismissed reminder must not come back on the next tick. */
export async function alertOnce(db: Executor, sandboxId: string, input: AlertInput, atSim: Date) {
  const [any] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.sandboxId, sandboxId), eq(alerts.dedupeKey, input.dedupeKey)));
  if (any) return;
  await openAlert(db, sandboxId, input, atSim);
}

const MOVING = ["departed", "transshipment", "border", "arrived", "customs"];

/** Status follows the confirmed milestones: on the way after departure, delivered after delivery. A closed shipment stays closed. */
export async function refreshStatus(db: Executor, sandboxId: string, s: ShipmentRow, ms: MilestoneRow[], simNow: Date) {
  if (s.status === "anulowana" || s.status === "dostarczona") return s.status;
  // The caller's row may be old (e.g. read before a slow AI call): the status as it is now decides.
  const [now] = await db.select({ status: shipments.status }).from(shipments).where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.id, s.id)));
  if (!now || now.status === "anulowana" || now.status === "dostarczona") return now?.status ?? s.status;
  const done = (kind: string) => ms.some((m) => m.kind === kind && m.actualSim);
  const status = done("delivered") ? "dostarczona" : ms.some((m) => MOVING.includes(m.kind) && m.actualSim) ? "w_drodze" : "planowana";
  if (status === s.status) return status;
  if (status === "dostarczona") {
    await setShipment(db, sandboxId, s.id, {
      status,
      nextClientUpdateSim: null,
      agentAwaitingReply: false,
    });
    await resolveAlerts(db, sandboxId, `shipment:${s.id}:`, simNow);
  } else await setShipment(db, sandboxId, s.id, { status });
  return status;
}

/**
 * After an ETA moved: the forwarder gets one alert, and the client update is brought
 * forward (to now for automatic updates, to within the hour otherwise).
 */
export async function onEtaChanged(db: Executor, sandboxId: string, s: ShipmentRow, oldEta: Date, newEta: Date, reason: string | null, simNow: Date) {
  const diffH = Math.round((newEta.getTime() - oldEta.getTime()) / H);
  if (Math.abs(diffH) < ETA_CHANGE_ALERT_H) return;
  const later = diffH > 0;
  const amount = Math.abs(diffH) >= 36 ? `${Math.round(Math.abs(diffH) / 24)} dni` : `${Math.abs(diffH)} h`;
  const destination = placeById(s.destinationId)?.name ?? s.destinationId;
  const severity: AlertSeverity = later ? "warning" : "info";
  await alertOnce(
    db,
    sandboxId,
    {
      kind: "shipment_eta",
      severity,
      dedupeKey: `shipment:${s.id}:eta:${newEta.getTime()}`,
      title: `${s.number}: ETA ${later ? "później" : "wcześniej"} o ${amount}`,
      body: `Agent podał nowe ETA ${destination}: ${formatShipmentDate(newEta.getTime())} (było ${formatShipmentDate(oldEta.getTime())}).${reason ? ` Powód: ${reason}.` : ""} ${s.autoClientUpdates ? "Klient dostanie aktualizację automatycznie." : "Klient powinien dostać aktualizację — przygotuj status."}`,
      actions: ["otworz_przesylke"],
      facts: {
        shipmentId: s.id,
        number: s.number,
        mode: MODE_LABEL[s.mode],
        oldEta: oldEta.toISOString(),
        newEta: newEta.toISOString(),
        reason,
      },
    },
    simNow,
  );
  const soon = new Date(simNow.getTime() + (s.autoClientUpdates ? 0 : H));
  if (!s.nextClientUpdateSim || s.nextClientUpdateSim > soon) await setShipment(db, sandboxId, s.id, { nextClientUpdateSim: soon });
}

/**
 * Reads an agent's status mail (AI, rules as fallback) and applies it: confirmed
 * milestones, the new ETA, the delay reason. A milestone confirmed by the forwarder
 * is never overwritten by a reading.
 */
export async function processAgentStatusReply(db: Executor, sandboxId: string, messageId: string, opts: { simNow: Date; skipAi?: boolean }) {
  const [m] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  const shipmentId = m?.threadKey.match(/^shp:(.+):agent$/)?.[1];
  if (!m || !shipmentId) return;
  const s = await loadShipment(db, sandboxId, shipmentId);
  if (!s || s.status === "anulowana" || s.status === "dostarczona") return;
  const outcome = await readShipmentStatus({
    db,
    sandboxId,
    simNow: opts.simNow,
    body: m.body,
    number: s.number,
    window: {
      fromMs: s.etdPlanned.getTime() - 30 * D,
      toMs: s.etaPlanned.getTime() + 90 * D,
    },
    skipAi: opts.skipAi,
  });
  const reading = outcome.value;
  const source = outcome.source === "ai" ? "agent_ai" : "agent_rules";
  await db
    .update(messages)
    .set({
      classifiedBy: outcome.source === "ai" ? "ai" : "rules",
      aiExtracted: {
        events: reading.events,
        etaMs: reading.etaMs,
        delayReason: reading.delayReason,
        confidence: reading.confidence,
      },
    })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));

  // An unsure reading — or one with nothing usable left after the date checks — changes nothing: a person reads the mail.
  if (reading.confidence < MIN_CONFIDENCE || (reading.events.length === 0 && reading.etaMs === null)) {
    const nothing = reading.events.length === 0 && reading.etaMs === null;
    await alertOnce(
      db,
      sandboxId,
      {
        kind: "shipment_unread_reply",
        severity: "info",
        dedupeKey: `shipment:${s.id}:unread:${messageId}`,
        title: `${s.number}: przeczytaj odpowiedź agenta`,
        body: nothing
          ? "System nie odczytał z odpowiedzi agenta dat ani ETA. Sprawdź treść i w razie potrzeby potwierdź etap ręcznie."
          : "Odczyt odpowiedzi agenta jest niepewny, więc przesyłka się nie zmieniła. Sprawdź treść i potwierdź etapy ręcznie.",
        actions: ["otworz_przesylke"],
        facts: { shipmentId: s.id, number: s.number, confidence: reading.confidence },
      },
      opts.simNow,
    );
    return;
  }

  // The AI call takes seconds and runs after the tick: read the shipment again, the forwarder may have acted meanwhile.
  const fresh = await loadShipment(db, sandboxId, s.id);
  if (!fresh || fresh.status === "anulowana" || fresh.status === "dostarczona") return;
  const ms = await loadMilestones(db, sandboxId, s.id);
  const updated: MilestoneRow[] = [];
  for (const ev of reading.events) {
    const target = ms.find((x) => x.kind === ev.kind);
    if (!target || target.source === "dispatcher" || target.actualSim?.getTime() === ev.atMs) continue;
    const actualSim = new Date(ev.atMs);
    const done = await db
      .update(shipmentMilestones)
      .set({ actualSim, source, sourceMessageId: messageId })
      .where(and(eq(shipmentMilestones.sandboxId, sandboxId), eq(shipmentMilestones.id, target.id), ne(shipmentMilestones.source, "dispatcher")))
      .returning({ id: shipmentMilestones.id });
    if (done.length) updated.push({ ...target, actualSim, source, sourceMessageId: messageId });
  }
  const current = ms.map((x) => updated.find((u) => u.id === x.id) ?? x);

  // ETA: the agent's figure, or the confirmed arrival once the cargo is there.
  const arrived = current.find((x) => x.kind === "arrived" && x.actualSim)?.actualSim ?? null;
  const newEta = arrived ?? (reading.etaMs ? new Date(reading.etaMs) : null);
  const patch: Partial<typeof shipments.$inferInsert> = {};
  if (reading.delayReason) patch.statusNote = reading.delayReason;
  if (newEta && newEta.getTime() !== fresh.etaCurrent.getTime()) patch.etaCurrent = newEta;
  if (Object.keys(patch).length) await setShipment(db, sandboxId, s.id, patch);
  const status = await refreshStatus(db, sandboxId, fresh, current, opts.simNow);
  if (newEta && status !== "dostarczona" && status !== "anulowana" && !arrived) await onEtaChanged(db, sandboxId, fresh, fresh.etaCurrent, newEta, reading.delayReason, opts.simNow);
}
