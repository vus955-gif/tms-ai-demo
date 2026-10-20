import { and, eq, inArray } from "drizzle-orm";
import { agents, clientContacts, messages, shipmentMilestones, shipments } from "@/db/schema";
import type { Executor } from "@/db/types";
import { CARRIER_SIGNATURE } from "@/domain/carrier";
import { agentStatusRequest, clientUpdateTemplate, refsText } from "@/domain/shipment-texts";
import { etaDelayHours, MODE_LABEL_GEN } from "@/domain/shipments";
import { agentStatusReplyText, type Truth } from "@/simulation/bots/shipment-agent-replies";
import { localizePlace, placeById } from "@/simulation/scenario/shipment-places";
import { seedSales } from "../sales/quotes";
import { registerSeedExtension } from "../sandbox/repository";
import { agentLanguage, agentThread, clientThread, routeOf, setShipment } from "./gateway";
import { insertShipment, type ShipmentInput } from "./shipments";
import { loadMilestones, loadShipment } from "./reading";

const H = 3_600_000;
const D = 24 * H;

type Seed = {
  id: string;
  number: string;
  input: Omit<ShipmentInput, "etd" | "eta"> & { mode: "sea" | "air" | "rail" };
  etd: number;
  eta: number;
  truth: Truth;
  /** Milestones already confirmed by the agent's last answer (taken from the truth). */
  history: { requestAt: number; replyAt: number | null }[];
  /** A request still waiting for an answer at the start (a slow agent). */
  awaitingSince?: number;
  lastClientUpdate: number;
  nextClientUpdate: number;
  autoClientUpdates?: boolean;
  bookingAt: number;
};

/**
 * Four shipments that show the module in the first hours of a demo world:
 * a ship whose agent is about to report congestion, a flight with automatic client
 * updates, a train whose slow agent needs a reminder at the border, and a booking to
 * New York whose first client update is due soon. Times are relative to `t0`.
 */
function seeds(t0: number): Seed[] {
  const morEtd = t0 - 20 * D;
  const lotEtd = t0 + 4 * H;
  const kolEtd = t0 - 14 * D;
  const mor2Etd = t0 + 3 * D;
  return [
    {
      id: "shp-demo-mor1",
      number: "MOR-2001",
      input: {
        mode: "sea",
        clientId: "cl-mazovia",
        contactId: "ct-mazovia-1",
        agentId: "ag-baltic-sea",
        originId: "port-shanghai",
        destinationId: "port-gdansk",
        incoterms: "FOB",
        cargo: "1 × 40' HC, elektronika użytkowa (monitory)",
        pieces: 412,
        weightKg: 18_400,
        volumeCbm: 68,
        refs: {
          booking: "SHAGDN4471",
          bl: "DEMOSHA2604471",
          container: "DEMU 744182-3",
          vessel: "MV Baltic Demo / 042W",
          clientRef: "MZE-PO-2291",
        },
      },
      etd: morEtd,
      eta: morEtd + 38 * D,
      truth: {
        departureDelayH: 0,
        middleDelayH: 52,
        arrivalDelayH: 0,
        reason: "kongestia w porcie Rotterdam",
        reasonEn: "congestion at Rotterdam",
      },
      history: [{ requestAt: t0 - 46 * H, replyAt: t0 - 45 * H }],
      lastClientUpdate: t0 - 30 * H,
      nextClientUpdate: t0 + 18 * H,
      bookingAt: morEtd - 10 * D,
    },
    {
      id: "shp-demo-lot1",
      number: "LOT-2001",
      input: {
        mode: "air",
        clientId: "cl-wisla",
        contactId: "ct-wisla-1",
        agentId: "ag-waw-cargo",
        originId: "air-waw",
        destinationId: "air-ord",
        incoterms: "DAP",
        cargo: "części zamienne do maszyn pakujących",
        pieces: 6,
        weightKg: 840,
        volumeCbm: 4.2,
        refs: {
          awb: "000-48213375",
          flight: "DM 4021 (WAW–ORD)",
          clientRef: "WL-2026-118",
        },
        autoClientUpdates: true,
      },
      etd: lotEtd,
      eta: lotEtd + 11 * H,
      truth: {
        departureDelayH: 3,
        middleDelayH: 0,
        arrivalDelayH: 0,
        reason: "opóźnienie lotu (pogoda)",
        reasonEn: "flight delayed (weather)",
      },
      history: [{ requestAt: t0 - 8 * H, replyAt: t0 - 7 * H }],
      lastClientUpdate: t0 - 11 * H,
      nextClientUpdate: t0 + 1 * H,
      autoClientUpdates: true,
      bookingAt: lotEtd - 3 * D,
    },
    {
      id: "shp-demo-kol1",
      number: "KOL-2001",
      input: {
        mode: "rail",
        clientId: "cl-meble",
        contactId: "ct-meble-1",
        agentId: "ag-eurasia",
        originId: "rail-xian",
        destinationId: "rail-lodz",
        incoterms: "FCA",
        cargo: "1 × 40' HC, okucia i elementy meblowe",
        pieces: 960,
        weightKg: 21_500,
        volumeCbm: 66,
        refs: {
          booking: "XIALDZ-0931",
          container: "DEMU 551207-9",
          train: "26-118 Xi'an–Łódź",
          clientRef: "MW/IMP/77",
        },
      },
      etd: kolEtd,
      eta: kolEtd + 18 * D,
      truth: {
        departureDelayH: 0,
        middleDelayH: 30,
        arrivalDelayH: 0,
        reason: "kolejka na przejściu granicznym w Małaszewiczach",
        reasonEn: "queue at the Małaszewicze border crossing",
      },
      history: [{ requestAt: t0 - 34 * H, replyAt: t0 - 33 * H }],
      awaitingSince: t0 - 10 * H,
      lastClientUpdate: t0 - 20 * H,
      nextClientUpdate: t0 + 4 * H,
      bookingAt: kolEtd - 7 * D,
    },
    {
      id: "shp-demo-mor2",
      number: "MOR-2002",
      input: {
        mode: "sea",
        clientId: "cl-sudety",
        contactId: "ct-sudety-1",
        agentId: "ag-hanseatic",
        originId: "port-gdansk",
        destinationId: "port-newyork",
        incoterms: "CIF",
        cargo: "2 × 40', papier w rolach",
        pieces: 48,
        weightKg: 48_000,
        volumeCbm: 120,
        refs: { booking: "GDNNYC-2207", clientRef: "SP/EXP/0412" },
      },
      etd: mor2Etd,
      eta: mor2Etd + 16 * D,
      truth: {
        departureDelayH: 0,
        middleDelayH: 0,
        arrivalDelayH: 0,
        reason: "zła pogoda na Atlantyku",
        reasonEn: "bad weather on the Atlantic",
      },
      history: [],
      lastClientUpdate: t0 - 2 * D,
      nextClientUpdate: t0 + 90 * 60_000,
      bookingAt: t0 - 2 * D,
    },
  ];
}

type MessageInsert = typeof messages.$inferInsert;

/** Adds the demo shipments with a short past: earlier status requests, answers and client updates. */
export async function seedShipments(db: Executor, sandboxId: string, start: Date) {
  const t0 = start.getTime();
  for (const seed of seeds(t0)) {
    const [exists] = await db
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.id, seed.id)));
    if (exists) continue;
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, seed.input.agentId)));
    const [contact] = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, seed.input.contactId)));
    if (!agent || !contact) continue; // a world without the scenario clients or agents (should not happen)
    await insertShipment(db, sandboxId, {
      id: seed.id,
      number: seed.number,
      input: {
        ...seed.input,
        etd: new Date(seed.etd).toISOString(),
        eta: new Date(seed.eta).toISOString(),
        incoterms: seed.input.incoterms ?? "",
        cargo: seed.input.cargo ?? "",
        refs: seed.input.refs ?? {},
        autoClientUpdates: seed.autoClientUpdates ?? false,
      },
      truth: seed.truth,
      createdSim: new Date(seed.bookingAt),
      ignoreExisting: true,
    });
    const s = (await loadShipment(db, sandboxId, seed.id))!;
    const ms = await loadMilestones(db, sandboxId, seed.id);
    const lang = agentLanguage(agent.id);
    const rows: MessageInsert[] = [];
    const base = {
      sandboxId,
      channel: "email" as const,
      party: "agent" as const,
      agentId: agent.id,
      threadKey: agentThread(s.id),
    };
    // What the agent said before the demo started: the truth up to then, without the delay that is still to come.
    const known: Truth = {
      ...seed.truth,
      departureDelayH: 0,
      middleDelayH: 0,
      arrivalDelayH: 0,
    };
    let lastRequest: number | null = null;
    for (const [i, h] of seed.history.entries()) {
      const req = agentStatusRequest({
        number: s.number,
        mode: s.mode,
        route: routeOf(s, lang),
        refs: s.refs,
        language: lang,
        signature: CARRIER_SIGNATURE,
      });
      rows.push({
        ...base,
        id: `${s.id}-req${i}`,
        direction: "out",
        subject: req.subject,
        body: req.body,
        state: "sent",
        sentBy: "system",
        atSim: new Date(h.requestAt),
        readAtSim: new Date(h.requestAt),
        kind: "shipment_status_request",
      });
      lastRequest = h.requestAt;
      if (h.replyAt !== null) {
        const body = agentStatusReplyText({
          language: lang,
          mode: s.mode,
          number: s.number,
          contactName: agent.contactName,
          milestones: ms.map((m) => ({
            kind: m.kind,
            location: localizePlace(m.location, lang),
            plannedMs: m.plannedSim.getTime(),
          })),
          truth: known,
          nowMs: h.replyAt,
        });
        const confirmedBy = `${s.id}-rep${i}`;
        rows.push({
          ...base,
          id: confirmedBy,
          direction: "in",
          subject: `${lang === "en" ? "RE" : "Re"}: ${req.subject}`,
          body,
          state: "received",
          sentBy: "agent",
          atSim: new Date(h.replyAt),
          readAtSim: new Date(h.replyAt),
          kind: "shipment_status_reply",
          classifiedBy: "rules",
        });
        // Milestones this answer confirmed (without the delay: it had not happened yet).
        for (const m of ms) {
          if (m.kind === "booking" || m.plannedSim.getTime() > h.replyAt) continue;
          m.actualSim = m.plannedSim;
          m.source = "agent_rules";
          m.sourceMessageId = confirmedBy;
        }
      }
    }
    if (seed.awaitingSince) {
      const req = agentStatusRequest({
        number: s.number,
        mode: s.mode,
        route: routeOf(s, lang),
        refs: s.refs,
        language: lang,
        signature: CARRIER_SIGNATURE,
      });
      rows.push({
        ...base,
        id: `${s.id}-reqw`,
        direction: "out",
        subject: req.subject,
        body: req.body,
        state: "sent",
        sentBy: "system",
        atSim: new Date(seed.awaitingSince),
        readAtSim: new Date(seed.awaitingSince),
        kind: "shipment_status_request",
      });
      lastRequest = seed.awaitingSince;
    }
    for (const m of ms) {
      if (m.source !== "agent_rules") continue;
      await db
        .update(shipmentMilestones)
        .set({
          actualSim: m.actualSim,
          source: m.source,
          sourceMessageId: m.sourceMessageId,
        })
        .where(and(eq(shipmentMilestones.sandboxId, sandboxId), eq(shipmentMilestones.id, m.id)));
    }
    // The last update the client got (from the template — before the demo, nobody watched).
    const confirmed = ms.filter((m) => m.actualSim && m.kind !== "booking" && m.actualSim.getTime() <= seed.lastClientUpdate);
    const last = confirmed.at(-1);
    const update = clientUpdateTemplate({
      number: s.number,
      clientRef: s.refs.clientRef ?? null,
      modeLabel: MODE_LABEL_GEN[s.mode],
      route: routeOf(s),
      destination: placeById(s.destinationId)?.name ?? "",
      refs: refsText({ ...s.refs, clientRef: "" }, { forClient: true }),
      last: last?.actualSim
        ? {
            label: last.label,
            location: last.location,
            atMs: last.actualSim.getTime(),
          }
        : null,
      next: null,
      etaMs: s.etaPlanned.getTime(),
      delayHours: etaDelayHours(s.etaPlanned.getTime(), s.etaPlanned.getTime()),
      delayReason: null,
      recipientName: contact.name,
      signature: CARRIER_SIGNATURE,
    });
    rows.push({
      sandboxId,
      id: `${s.id}-cli0`,
      channel: "email",
      direction: "out",
      party: "client",
      clientContactId: contact.id,
      threadKey: clientThread(s.id),
      subject: update.subject,
      body: update.body,
      state: "sent",
      sentBy: seed.autoClientUpdates ? "system" : "dispatcher",
      atSim: new Date(seed.lastClientUpdate),
      readAtSim: new Date(seed.lastClientUpdate),
      kind: seed.autoClientUpdates ? "shipment_update_auto" : "shipment_update",
      classifiedBy: "rules",
    });
    await db.insert(messages).values(rows).onConflictDoNothing();

    const moving = ms.some((m) => m.actualSim && ["departed", "transshipment", "border", "arrived"].includes(m.kind));
    await setShipment(db, sandboxId, s.id, {
      status: moving ? "w_drodze" : "planowana",
      lastAgentRequestSim: lastRequest !== null ? new Date(lastRequest) : null,
      agentAwaitingReply: Boolean(seed.awaitingSince),
      lastClientUpdateSim: new Date(seed.lastClientUpdate),
      nextClientUpdateSim: new Date(seed.nextClientUpdate),
    });
  }
}

/** New worlds get the demo shipments at their start. */
registerSeedExtension(async (db, sandbox) => {
  await seedShipments(db, sandbox.id, sandbox.simOrigin);
});

const DEMO_IDS = ["shp-demo-mor1", "shp-demo-lot1", "shp-demo-kol1", "shp-demo-mor2"];

/**
 * Worlds created before the module get the demo shipments on the first visit, starting
 * "now" — and first the agents added with the module, which those worlds do not have.
 */
export async function ensureShipmentsSeeded(db: Executor, sandboxId: string, simNow: Date) {
  const have = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(eq(shipments.sandboxId, sandboxId), inArray(shipments.id, DEMO_IDS)));
  if (have.length === DEMO_IDS.length) return;
  await seedSales(db, sandboxId);
  await seedShipments(db, sandboxId, simNow);
}
