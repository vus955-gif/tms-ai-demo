import { and, eq } from "drizzle-orm";
import { agents, shipmentMilestones, shipments } from "@/db/schema";
import type { Executor } from "@/db/types";
import { agentStatusRequest } from "@/domain/shipment-texts";
import { nextAgentRequestMs } from "@/domain/shipments";
import { CARRIER_SIGNATURE } from "@/domain/carrier";
import { createRng, seedFromString } from "@/simulation/random";
import { agentsSeed } from "@/simulation/scenario/agents";
import { placeById } from "@/simulation/scenario/shipment-places";
import { storeAgentMessage } from "../sales/gateway";

/**
 * Mail around a shipment. Demo: nothing leaves the app — requests to agents and
 * updates for clients are only stored, the agent's answer comes from a bot.
 */
export const agentThread = (shipmentId: string) => `shp:${shipmentId}:agent`;
export const clientThread = (shipmentId: string) => `shp:${shipmentId}:client`;

export type ShipmentRow = typeof shipments.$inferSelect;
export type MilestoneRow = typeof shipmentMilestones.$inferSelect;

const MIN = 60_000;

export const agentLanguage = (agentId: string) => agentsSeed.find((a) => a.id === agentId)?.language ?? "pl";

/** "Szanghaj → Gdańsk (DCT)"; for English-speaking agents "Shanghai → Gdańsk (DCT)". */
export function routeOf(s: Pick<ShipmentRow, "originId" | "destinationId">, language: "pl" | "en" = "pl") {
  const name = (id: string) => {
    const p = placeById(id);
    return p ? (language === "en" ? (p.nameEn ?? p.name) : p.name) : id;
  };
  return `${name(s.originId)} → ${name(s.destinationId)}`;
}

/** When the system asks the agent next (the rhythm, an overdue milestone, the delay the agent already reported). */
export function agentRequestDue(s: ShipmentRow, ms: MilestoneRow[], nowMs: number): number {
  return nextAgentRequestMs(
    s.agentEveryHours,
    (s.lastAgentRequestSim ?? s.createdSim).getTime(),
    ms.map((m) => ({ kind: m.kind, seq: m.seq, plannedMs: m.plannedSim.getTime(), actualMs: m.actualSim?.getTime() ?? null })),
    nowMs,
    s.etaCurrent.getTime() - s.etaPlanned.getTime(),
  );
}

export const setShipment = (db: Executor, sandboxId: string, id: string, patch: Partial<typeof shipments.$inferInsert>) =>
  db
    .update(shipments)
    .set(patch)
    .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.id, id)));

/**
 * Sends (stores) a status request or a reminder and lets the demo agent answer later.
 * Demo bots answer most first requests within one to three hours; slow ones only
 * after a reminder, and now and then not at all (the forwarder then gets an alert).
 */
export async function sendAgentRequest(
  db: Executor,
  sandboxId: string,
  s: ShipmentRow,
  simNow: Date,
  opts: {
    reminder: boolean;
    by: "system" | "dispatcher";
    schedule: (dueSim: Date, payload: Record<string, unknown>) => Promise<void>;
  },
) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, s.agentId)));
  const text = agentStatusRequest({
    number: s.number,
    mode: s.mode,
    route: routeOf(s, agentLanguage(s.agentId)),
    refs: s.refs,
    language: agentLanguage(s.agentId),
    signature: CARRIER_SIGNATURE,
    reminder: opts.reminder,
  });
  const messageId = await storeAgentMessage(db, sandboxId, {
    agentId: s.agentId,
    threadKey: agentThread(s.id),
    direction: "out",
    subject: text.subject,
    body: text.body,
    atSim: simNow,
    state: "sent",
    sentBy: opts.by,
    kind: opts.reminder ? "shipment_status_reminder" : "shipment_status_request",
  });
  await setShipment(
    db,
    sandboxId,
    s.id,
    opts.reminder
      ? { agentRemindedSim: simNow }
      : {
          lastAgentRequestSim: simNow,
          agentAwaitingReply: true,
          agentRemindedSim: null,
        },
  );
  // Seeded by shipment and time (not the random message id), so a replayed timeline behaves the same.
  const rng = createRng(seedFromString(`${s.id}:${simNow.getTime()}:${opts.reminder ? "r" : "q"}`));
  const replyRate = agent?.replyRate ?? 0.75;
  const answers = opts.reminder ? rng.chance(0.85) : rng.chance(replyRate);
  if (answers) {
    const delay = opts.reminder ? rng.int(30, 120) : rng.int(40, 180);
    await opts.schedule(new Date(simNow.getTime() + delay * MIN), {
      shipmentId: s.id,
      requestId: messageId,
    });
  }
  return messageId;
}
