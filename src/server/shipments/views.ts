import { and, asc, eq, inArray, like, lte } from "drizzle-orm";
import { agents, alerts, clientContacts, clients, messages, quoteRequests, shipmentMilestones, shipments, type ShipmentStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import { EMPTY_DETAILS, type QuoteDetails } from "@/domain/quote-rules";
import type { StatusReading } from "@/domain/shipment-texts";
import { AGENT_REMIND_AFTER_H, CLIENT_REMIND_BEFORE_MS, clientUpdateState, etaDelayHours, MODE_LABEL, type ClientUpdateState, type MilestoneKind, type ShipmentMode } from "@/domain/shipments";
import { normalize } from "@/domain/email-rules";
import { laneOptions, placeById, shipmentPlaces } from "@/simulation/scenario/shipment-places";
import { agentsSeed } from "@/simulation/scenario/agents";
import { HttpError } from "../http";
import { agentRequestDue, agentThread, clientThread, type MilestoneRow, type ShipmentRow } from "./gateway";
import { shipmentDraftFromQuote } from "./shipments";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export type ShipmentListItem = {
  id: string;
  number: string;
  mode: ShipmentMode;
  modeLabel: string;
  status: ShipmentStatus;
  clientName: string;
  origin: string;
  destination: string;
  etaPlanned: string;
  etaCurrent: string;
  delayHours: number;
  last: { label: string; location: string; at: string } | null;
  clientUpdate: {
    state: ClientUpdateState;
    next: string | null;
    auto: boolean;
  };
  agent: { company: string; awaiting: boolean; reminded: boolean };
  /** Open ETA alert (news the forwarder has not acted on). */
  etaNews: boolean;
};

function lastConfirmed(ms: MilestoneRow[]) {
  return (
    ms
      .filter((m) => m.actualSim && m.kind !== "booking")
      .sort((a, b) => a.actualSim!.getTime() - b.actualSim!.getTime())
      .at(-1) ?? null
  );
}

function listItem(s: ShipmentRow, ms: MilestoneRow[], clientName: string, agentCompany: string, etaNews: boolean, simNow: Date): ShipmentListItem {
  const last = lastConfirmed(ms);
  const active = s.status === "planowana" || s.status === "w_drodze";
  return {
    id: s.id,
    number: s.number,
    mode: s.mode,
    modeLabel: MODE_LABEL[s.mode],
    status: s.status,
    clientName,
    origin: placeById(s.originId)?.name ?? s.originId,
    destination: placeById(s.destinationId)?.name ?? s.destinationId,
    etaPlanned: s.etaPlanned.toISOString(),
    etaCurrent: s.etaCurrent.toISOString(),
    delayHours: etaDelayHours(s.etaPlanned.getTime(), s.etaCurrent.getTime()),
    last: last
      ? {
          label: last.label,
          location: last.location,
          at: last.actualSim!.toISOString(),
        }
      : null,
    clientUpdate: {
      // With automatic updates nothing waits for the forwarder.
      state: active && !s.autoClientUpdates ? clientUpdateState(s.nextClientUpdateSim?.getTime() ?? null, simNow.getTime()) : "ok",
      next: active ? iso(s.nextClientUpdateSim) : null,
      auto: s.autoClientUpdates,
    },
    agent: {
      company: agentCompany,
      awaiting: active && s.agentAwaitingReply,
      reminded: active && s.agentAwaitingReply && s.agentRemindedSim !== null,
    },
    etaNews,
  };
}

const STATUS_RANK: Record<ShipmentStatus, number> = {
  w_drodze: 0,
  planowana: 1,
  dostarczona: 2,
  anulowana: 3,
};
const ATTENTION: Record<ClientUpdateState, number> = {
  po_terminie: 0,
  wkrotce: 1,
  ok: 2,
};

/** All shipments, the ones that need the forwarder first (client update due, ETA news), then by ETA. */
export async function shipmentsOverview(db: Executor, sandboxId: string, simNow: Date): Promise<ShipmentListItem[]> {
  const [rows, ms, clientRows, agentRows, etaAlerts] = await Promise.all([
    db.select().from(shipments).where(eq(shipments.sandboxId, sandboxId)),
    db.select().from(shipmentMilestones).where(eq(shipmentMilestones.sandboxId, sandboxId)),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.sandboxId, sandboxId)),
    db.select({ id: agents.id, company: agents.company }).from(agents).where(eq(agents.sandboxId, sandboxId)),
    db
      .select({ dedupeKey: alerts.dedupeKey })
      .from(alerts)
      .where(and(eq(alerts.sandboxId, sandboxId), like(alerts.dedupeKey, "shipment:%:eta:%"), inArray(alerts.status, ["open", "acknowledged"]))),
  ]);
  const items = rows.map((s) =>
    listItem(
      s,
      ms.filter((m) => m.shipmentId === s.id),
      clientRows.find((c) => c.id === s.clientId)?.name ?? "",
      agentRows.find((a) => a.id === s.agentId)?.company ?? s.agentId,
      etaAlerts.some((a) => a.dedupeKey.startsWith(`shipment:${s.id}:eta:`)),
      simNow,
    ),
  );
  return items.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      ATTENTION[a.clientUpdate.state] - ATTENTION[b.clientUpdate.state] ||
      Number(b.etaNews) - Number(a.etaNews) ||
      a.etaCurrent.localeCompare(b.etaCurrent),
  );
}

type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  state: string;
  subject: string;
  body: string;
  atSim: string;
  sentBy: string | null;
  kind: string | null;
  classifiedBy: string | null;
  reading: {
    events: { kind: string; at: string }[];
    eta: string | null;
    delayReason: string | null;
  } | null;
};

function threadMessage(m: typeof messages.$inferSelect): ThreadMessage {
  const r = m.kind === "shipment_status_reply" ? (m.aiExtracted as (StatusReading & { etaMs: number | null }) | null) : null;
  return {
    id: m.id,
    direction: m.direction,
    state: m.state,
    subject: m.subject ?? "",
    body: m.body,
    atSim: m.atSim.toISOString(),
    sentBy: m.sentBy,
    kind: m.kind,
    classifiedBy: m.classifiedBy,
    reading: r
      ? {
          events: r.events.map((e) => ({
            kind: e.kind,
            at: new Date(e.atMs).toISOString(),
          })),
          eta: r.etaMs ? new Date(r.etaMs).toISOString() : null,
          delayReason: r.delayReason,
        }
      : null,
  };
}

const placePoint = (name: string, lng: number, lat: number) => ({
  name,
  lng,
  lat,
});

export async function shipmentDetail(db: Executor, sandboxId: string, id: string, simNow: Date) {
  const [s] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.id, id)));
  if (!s) throw new HttpError(404, "Nie ma takiej przesyłki.");
  const [ms, [client], [contact], [agent], thread, alertRows, [quote]] = await Promise.all([
    db
      .select()
      .from(shipmentMilestones)
      .where(and(eq(shipmentMilestones.sandboxId, sandboxId), eq(shipmentMilestones.shipmentId, id)))
      .orderBy(asc(shipmentMilestones.seq)),
    db
      .select()
      .from(clients)
      .where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, s.clientId))),
    s.contactId
      ? db
          .select()
          .from(clientContacts)
          .where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, s.contactId)))
      : Promise.resolve([]),
    db
      .select()
      .from(agents)
      .where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, s.agentId))),
    db
      .select()
      .from(messages)
      .where(and(eq(messages.sandboxId, sandboxId), inArray(messages.threadKey, [agentThread(id), clientThread(id)])))
      .orderBy(asc(messages.atSim), asc(messages.direction), asc(messages.id)),
    db
      .select({ dedupeKey: alerts.dedupeKey })
      .from(alerts)
      .where(and(eq(alerts.sandboxId, sandboxId), like(alerts.dedupeKey, `shipment:${id}:eta:%`), inArray(alerts.status, ["open", "acknowledged"]))),
    s.quoteId
      ? db
          .select({ id: quoteRequests.id, number: quoteRequests.number })
          .from(quoteRequests)
          .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, s.quoteId)))
      : Promise.resolve([]),
  ]);
  const origin = placeById(s.originId);
  const destination = placeById(s.destinationId);
  const middlePlace = s.middleName ? shipmentPlaces.find((p) => p.name === s.middleName) : undefined;
  const coordsOf = (location: string) => [origin, middlePlace, destination].find((p) => p?.name === location);
  const last = lastConfirmed(ms);
  const lastPlace = last ? coordsOf(last.location) : undefined;
  const active = s.status === "planowana" || s.status === "w_drodze";
  const draft = thread.find((m) => m.threadKey === clientThread(id) && m.state === "draft");
  const nextAgent =
    active && !s.agentAwaitingReply
      ? agentRequestDue(s, ms, simNow.getTime())
      : null;
  return {
    ...listItem(s, ms, client?.name ?? "", agent?.company ?? s.agentId, alertRows.length > 0, simNow),
    route: `${origin?.name ?? s.originId} → ${destination?.name ?? s.destinationId}`,
    refs: s.refs,
    cargo: s.cargo,
    incoterms: s.incoterms,
    pieces: s.pieces,
    weightKg: s.weightKg,
    volumeCbm: s.volumeCbm,
    etdPlanned: s.etdPlanned.toISOString(),
    statusNote: s.statusNote,
    client: { id: s.clientId, name: client?.name ?? "" },
    contact: contact ? { name: contact.name, email: contact.email } : null,
    agentInfo: agent
      ? {
          id: agent.id,
          company: agent.company,
          contactName: agent.contactName,
          email: agent.email,
          language: agentsSeed.find((a) => a.id === agent.id)?.language ?? "pl",
        }
      : null,
    quote: quote ?? null,
    milestones: ms.map((m) => ({
      id: m.id,
      kind: m.kind as MilestoneKind,
      label: m.label,
      location: m.location,
      planned: m.plannedSim.toISOString(),
      actual: iso(m.actualSim),
      source: m.source,
    })),
    map: {
      path: s.path,
      origin: origin ? placePoint(origin.name, origin.lng, origin.lat) : null,
      destination: destination ? placePoint(destination.name, destination.lng, destination.lat) : null,
      middle: middlePlace ? placePoint(middlePlace.name, middlePlace.lng, middlePlace.lat) : null,
      lastConfirmed:
        last && lastPlace
          ? {
              ...placePoint(lastPlace.name, lastPlace.lng, lastPlace.lat),
              label: last.label,
              at: last.actualSim!.toISOString(),
            }
          : null,
    },
    agentThread: thread.filter((m) => m.threadKey === agentThread(id)).map(threadMessage),
    clientThread: thread.filter((m) => m.threadKey === clientThread(id) && m.state !== "draft").map(threadMessage),
    draft: draft
      ? {
          id: draft.id,
          subject: draft.subject ?? "",
          body: draft.body,
          classifiedBy: draft.classifiedBy,
        }
      : null,
    settings: {
      agentEveryHours: s.agentEveryHours,
      clientEveryHours: s.clientEveryHours,
      autoClientUpdates: s.autoClientUpdates,
    },
    schedule: {
      nextAgentRequest: nextAgent !== null ? new Date(Math.max(nextAgent, simNow.getTime())).toISOString() : null,
      lastAgentRequest: iso(s.lastAgentRequestSim),
      reminderDue:
        active && s.agentAwaitingReply && s.lastAgentRequestSim && !s.agentRemindedSim ? new Date(s.lastAgentRequestSim.getTime() + AGENT_REMIND_AFTER_H[s.mode] * 3_600_000).toISOString() : null,
      lastClientUpdate: iso(s.lastClientUpdateSim),
    },
  };
}
export type ShipmentDetail = Awaited<ReturnType<typeof shipmentDetail>>;

/** Everything the "Nowa przesyłka" form needs: clients with contacts, agents by mode, places and lanes. */
export async function shipmentFormOptions(db: Executor, sandboxId: string) {
  const [clientRows, contactRows, agentRows] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.sandboxId, sandboxId)).orderBy(asc(clients.name)),
    db
      .select({
        id: clientContacts.id,
        clientId: clientContacts.clientId,
        name: clientContacts.name,
      })
      .from(clientContacts)
      .where(eq(clientContacts.sandboxId, sandboxId)),
    db
      .select()
      .from(agents)
      .where(and(eq(agents.sandboxId, sandboxId), eq(agents.active, true)))
      .orderBy(asc(agents.company)),
  ]);
  return {
    clients: clientRows.map((c) => ({
      ...c,
      contacts: contactRows.filter((p) => p.clientId === c.id).map((p) => ({ id: p.id, name: p.name })),
    })),
    agents: agentRows.map((a) => ({
      id: a.id,
      company: a.company,
      modes: a.modes.filter((m): m is ShipmentMode => m !== "road"),
      regions: a.regions,
    })),
    places: shipmentPlaces.map((p) => ({
      id: p.id,
      name: p.name,
      modes: p.modes,
    })),
    lanes: laneOptions(),
  };
}
export type ShipmentFormOptions = Awaited<ReturnType<typeof shipmentFormOptions>>;

const ALIASES: Record<string, string[]> = {
  "port-shanghai": ["shanghai", "szanghaj"],
  "port-ningbo": ["ningbo"],
  "port-singapore": ["singapore", "singapur"],
  "port-gdansk": ["gdansk", "gdynia"],
  "port-hamburg": ["hamburg"],
  "port-rotterdam": ["rotterdam"],
  "port-newyork": ["new york", "nowy jork", "newark"],
  "air-waw": ["warszawa", "warsaw", "waw"],
  "air-fra": ["frankfurt", "fra"],
  "air-lej": ["lipsk", "leipzig", "lej"],
  "air-ord": ["chicago", "ord"],
  "air-jfk": ["new york", "nowy jork", "jfk"],
  "air-pvg": ["shanghai", "szanghaj", "pvg"],
  "air-dxb": ["dubaj", "dubai", "dxb"],
  "rail-xian": ["xi'an", "xian"],
  "rail-chengdu": ["chengdu"],
  "rail-malaszewicze": ["malaszewicze"],
  "rail-lodz": ["lodz"],
  "rail-duisburg": ["duisburg"],
};

/** The place of this mode named in the quote's free text ("Gdańsk", "Shanghai port"), if any. */
function matchPlace(mode: ShipmentMode, text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = normalize(text);
  const hit = shipmentPlaces.find((p) => p.modes.includes(mode) && (ALIASES[p.id] ?? []).some((a) => new RegExp(`\\b${a.replace("'", "'?")}\\b`).test(norm)));
  return hit?.id ?? null;
}

/** Prefill for "Utwórz przesyłkę" from a won quote; the forwarder checks and completes it. */
export async function shipmentPrefill(db: Executor, sandboxId: string, quoteId: string) {
  const { quote, agentId } = await shipmentDraftFromQuote(db, sandboxId, quoteId);
  const d = { ...EMPTY_DETAILS, ...(quote.details as Partial<QuoteDetails>) };
  const mode = quote.mode as ShipmentMode;
  const cargo = [d.containerType ? `${d.containers ?? 1} × ${d.containerType}'` : null, d.commodity].filter(Boolean).join(", ");
  return {
    quoteId: quote.id,
    quoteNumber: quote.number,
    mode,
    clientId: quote.clientId,
    contactId: quote.contactId,
    agentId,
    originId: matchPlace(mode, d.origin),
    destinationId: matchPlace(mode, d.destination),
    incoterms: d.incoterms ?? "",
    cargo: cargo.slice(0, 120),
    pieces: d.pallets ?? d.packages ?? null,
    weightKg: d.weightKg ? Math.round(d.weightKg) : null,
    volumeCbm: d.volumeCbm ?? null,
  };
}
export type ShipmentPrefill = Awaited<ReturnType<typeof shipmentPrefill>>;

/** Nav badge: shipments whose client update is due within the reminder window (manual updates only). */
export async function shipmentsAttentionCount(db: Executor, sandboxId: string, simNow: Date): Promise<number> {
  const rows = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(
      and(
        eq(shipments.sandboxId, sandboxId),
        inArray(shipments.status, ["planowana", "w_drodze"]),
        eq(shipments.autoClientUpdates, false),
        lte(shipments.nextClientUpdateSim, new Date(simNow.getTime() + CLIENT_REMIND_BEFORE_MS)),
      ),
    );
  return rows.length;
}
