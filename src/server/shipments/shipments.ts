import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agentQuotes, agents, clientContacts, clients, messages, quoteRequests, shipmentMilestones, shipments } from "@/db/schema";
import { uniqueViolation } from "@/db/errors";
import type { Db, Executor } from "@/db/types";
import { draftShipmentUpdate } from "@/ai/functions/shipments";
import { CARRIER_SIGNATURE } from "@/domain/carrier";
import { leaksClientData } from "@/domain/client-leak";
import { parseShipmentTime, refsText, type ClientUpdateFacts } from "@/domain/shipment-texts";
import { AGENT_EVERY_HOURS, CLIENT_EVERY_HOURS, densifyPath, etaDelayHours, MODE_LABEL_GEN, MODE_TRANSPORT_GEN, planMilestones, type ShipmentMode } from "@/domain/shipments";
import { createRng, seedFromString } from "@/simulation/random";
import { laneExists, laneMiddle, lanePath, placeById } from "@/simulation/scenario/shipment-places";
import type { Truth } from "@/simulation/bots/shipment-agent-replies";
import { HttpError } from "../http";
import { discardDraft, sendDraft } from "../inbox/actions";
import { saveDraft } from "../inbox/gateway";
import { resolveAlerts } from "../alerts/repository";
import { scheduleEvent } from "../tick/engine";
import { clientThread, routeOf, sendAgentRequest, setShipment, type MilestoneRow, type ShipmentRow } from "./gateway";
import { loadMilestones, loadShipment, refreshStatus } from "./reading";

const H = 3_600_000;
const D = 24 * H;

export const NUMBER_PREFIX: Record<ShipmentMode, string> = {
  sea: "MOR",
  air: "LOT",
  rail: "KOL",
};
/** Per demo world, like the other limits (clients, points). */
export const MAX_SHIPMENTS = 40;

const Ref = z.string().trim().max(40).optional();
const isoDate = z
  .string()
  .trim()
  .refine((v) => Number.isFinite(parseShipmentTime(v)), "Niepoprawna data.")
  .transform((v) => new Date(parseShipmentTime(v)).toISOString());

export const ShipmentInputSchema = z.object({
  mode: z.enum(["sea", "air", "rail"]),
  clientId: z.string().trim().min(1, "Wybierz klienta.").max(64),
  contactId: z.string().trim().min(1, "Wybierz osobę kontaktową klienta.").max(64),
  agentId: z.string().trim().min(1, "Wybierz agenta.").max(64),
  originId: z.string().trim().min(1).max(64),
  destinationId: z.string().trim().min(1).max(64),
  etd: isoDate,
  eta: isoDate,
  incoterms: z.string().trim().max(3).default(""),
  cargo: z.string().trim().max(120).default(""),
  pieces: z.number().int().min(1).max(100_000).nullable().optional(),
  weightKg: z.number().int().min(1).max(500_000).nullable().optional(),
  volumeCbm: z.number().min(0.01).max(5_000).nullable().optional(),
  refs: z
    .object({
      booking: Ref,
      bl: Ref,
      awb: Ref,
      container: Ref,
      vessel: Ref,
      flight: Ref,
      train: Ref,
      clientRef: Ref,
    })
    .default({}),
  quoteId: z.string().trim().max(64).nullable().optional(),
  autoClientUpdates: z.boolean().default(false),
});
export type ShipmentInput = z.input<typeof ShipmentInputSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join(" "));
  return r.data;
}

async function nextNumber(db: Executor, sandboxId: string, mode: ShipmentMode) {
  const rows = await db
    .select({ number: shipments.number })
    .from(shipments)
    .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.mode, mode)));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.replace(/\D/g, "")) || 0), 2000);
  return `${NUMBER_PREFIX[mode]}-${max + 1}`;
}

const REASONS: Record<ShipmentMode, [string, string][]> = {
  sea: [
    ["kongestia w porcie przeładunkowym", "congestion at the transshipment port"],
    ["zła pogoda na trasie", "bad weather on the route"],
    ["statek przesunięty na późniejszy rejs", "rolled to a later sailing"],
  ],
  air: [
    ["brak miejsca na pierwotnym locie — przebukowanie", "offloaded from the original flight, rebooked"],
    ["opóźnienie lotu (pogoda)", "flight delayed (weather)"],
  ],
  rail: [
    ["kolejka na przejściu granicznym", "queue at the border crossing"],
    ["przeładunek na zmianę rozstawu torów trwa dłużej", "gauge-change transshipment taking longer"],
  ],
};

/** Demo only: how this shipment will really go (bots report it, the system learns it from their mail). */
export function demoTruth(seed: string, mode: ShipmentMode): Truth {
  const rng = createRng(seedFromString(seed));
  const [reason, reasonEn] = rng.pick(REASONS[mode]);
  const pick = (opts: number[]) => rng.pick(opts);
  if (mode === "air")
    return {
      departureDelayH: pick([0, 0, 3, 8]),
      middleDelayH: 0,
      arrivalDelayH: pick([0, 0, 2]),
      reason,
      reasonEn,
    };
  if (mode === "rail")
    return {
      departureDelayH: pick([0, 0, 12]),
      middleDelayH: pick([0, 12, 36]),
      arrivalDelayH: pick([0, 6]),
      reason,
      reasonEn,
    };
  return {
    departureDelayH: pick([0, 0, 6, 24]),
    middleDelayH: pick([0, 0, 24, 48]),
    arrivalDelayH: pick([0, 0, 12]),
    reason,
    reasonEn,
  };
}

export type NewShipment = {
  id?: string;
  number?: string;
  input: z.output<typeof ShipmentInputSchema>;
  truth: Truth;
  createdSim: Date;
  /** Seeding: two first visits at once must not fail on the second insert. */
  ignoreExisting?: boolean;
};

/** Inserts the shipment and its milestone plan (no checks — see createShipment). */
export async function insertShipment(db: Executor, sandboxId: string, n: NewShipment) {
  const i = n.input;
  const id = n.id ?? `shp-${randomUUID().slice(0, 12)}`;
  const etd = new Date(i.etd);
  const eta = new Date(i.eta);
  const origin = placeById(i.originId)!;
  const destination = placeById(i.destinationId)!;
  const middle = laneMiddle(i.mode, i.originId, i.destinationId);
  const plan = planMilestones(i.mode, etd.getTime(), eta.getTime(), {
    origin: origin.name,
    destination: destination.name,
    middle: middle ?? undefined,
  });
  const refs = Object.fromEntries(Object.entries(i.refs).filter(([, v]) => v)) as Record<string, string>;
  const row: typeof shipments.$inferInsert = {
    sandboxId,
    id,
    number: n.number ?? (await nextNumber(db, sandboxId, i.mode)),
    mode: i.mode,
    status: "planowana",
    clientId: i.clientId,
    contactId: i.contactId,
    agentId: i.agentId,
    quoteId: i.quoteId ?? null,
    originId: i.originId,
    destinationId: i.destinationId,
    middleName: middle?.name ?? null,
    middleFraction: middle?.fraction ?? null,
    path: densifyPath(lanePath(i.mode, i.originId, i.destinationId)),
    incoterms: i.incoterms.toUpperCase(),
    cargo: i.cargo,
    pieces: i.pieces ?? null,
    weightKg: i.weightKg ?? null,
    volumeCbm: i.volumeCbm ?? null,
    refs,
    etdPlanned: etd,
    etaPlanned: eta,
    etaCurrent: eta,
    truth: n.truth,
    agentEveryHours: AGENT_EVERY_HOURS[i.mode],
    clientEveryHours: CLIENT_EVERY_HOURS[i.mode],
    nextClientUpdateSim: new Date(n.createdSim.getTime() + CLIENT_EVERY_HOURS[i.mode] * H),
    autoClientUpdates: i.autoClientUpdates,
    createdSim: n.createdSim,
  };
  if (n.ignoreExisting) await db.insert(shipments).values(row).onConflictDoNothing();
  else await db.insert(shipments).values(row);
  const milestoneRows = plan.map((m) => ({
    sandboxId,
    id: `${id}-${m.seq}`,
    shipmentId: id,
    seq: m.seq,
    kind: m.kind,
    label: m.label,
    location: m.location,
    plannedSim: new Date(m.plannedMs),
    // The forwarder creates the shipment once the booking is confirmed.
    actualSim: m.kind === "booking" ? n.createdSim : null,
    source: m.kind === "booking" ? ("dispatcher" as const) : ("plan" as const),
  }));
  if (n.ignoreExisting) await db.insert(shipmentMilestones).values(milestoneRows).onConflictDoNothing();
  else await db.insert(shipmentMilestones).values(milestoneRows);
  return id;
}

/** A new shipment from the form (manually or from a won quote). The agent is asked about it on the regular rhythm. */
export async function createShipment(db: Executor, sandboxId: string, raw: ShipmentInput, simNow: Date) {
  const input = parse(ShipmentInputSchema, raw);
  if (!laneExists(input.mode, input.originId, input.destinationId)) throw new HttpError(400, "Tej trasy nie ma w demo — wybierz miejsca z listy dla tego rodzaju transportu.");
  const etd = Date.parse(input.etd);
  const eta = Date.parse(input.eta);
  if (eta <= etd) throw new HttpError(400, "ETA musi być późniejsze niż ETD.");
  if (eta - etd > 90 * D) throw new HttpError(400, "Tranzyt dłuższy niż 90 dni — sprawdź daty.");
  if (etd < simNow.getTime() - 60 * D || etd > simNow.getTime() + 180 * D) throw new HttpError(400, "ETD poza rozsądnym zakresem (od 60 dni wstecz do 180 dni naprzód).");
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, input.clientId)));
  if (!client) throw new HttpError(404, "Nie ma takiego klienta.");
  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, input.contactId)));
  if (!contact || contact.clientId !== client.id) throw new HttpError(400, "Ta osoba nie należy do wybranego klienta.");
  // Every number except the client's reference goes to the agent: no client name, person, e-mail or phone in them.
  const forAgent = Object.entries(input.refs)
    .filter(([k, v]) => k !== "clientRef" && v)
    .map(([, v]) => v)
    .join("\n");
  const people = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.clientId, client.id)));
  if (forAgent && leaksClientData(forAgent, client, people)) {
    throw new HttpError(400, "Numery dla agenta zawierają dane klienta (nazwę, osobę, e-mail lub telefon). Referencję klienta wpisz w polu „Ref. klienta” — agent jej nie dostaje.");
  }
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, input.agentId)));
  if (!agent || !agent.active) throw new HttpError(400, "Nie ma takiego aktywnego agenta.");
  if (!agent.modes.includes(input.mode)) throw new HttpError(400, `Ten agent nie obsługuje ${MODE_TRANSPORT_GEN[input.mode]}.`);
  if (input.quoteId) {
    const [q] = await db
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, input.quoteId)));
    if (!q || q.status !== "wygrana") throw new HttpError(409, "Przesyłkę z wyceny można utworzyć tylko dla wygranej wyceny.");
    if (q.clientId !== client.id) throw new HttpError(400, "Klient różni się od klienta z wyceny.");
    if (q.mode !== input.mode) throw new HttpError(400, "Rodzaj transportu różni się od wyceny.");
    const [existing] = await db
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.quoteId, q.id)));
    if (existing) throw new HttpError(409, "Dla tej wyceny przesyłka już istnieje.");
  }
  const all = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.sandboxId, sandboxId));
  if (all.length >= MAX_SHIPMENTS) throw new HttpError(409, `W demo można mieć do ${MAX_SHIPMENTS} przesyłek.`);
  const id = `shp-${randomUUID().slice(0, 12)}`;
  try {
    return await insertShipment(db, sandboxId, { id, input, truth: demoTruth(`${sandboxId}:${id}`, input.mode), createdSim: simNow });
  } catch (error) {
    // Two clicks at once: the database keeps numbers and "one shipment per quote" unique.
    if (uniqueViolation(error) !== null) throw new HttpError(409, "Przesyłka z tym numerem albo z tej wyceny właśnie powstała — odśwież listę.");
    throw error;
  }
}

async function shipmentOr404(db: Executor, sandboxId: string, id: string) {
  const s = await loadShipment(db, sandboxId, id);
  if (!s) throw new HttpError(404, "Nie ma takiej przesyłki.");
  return s;
}

function assertActive(s: ShipmentRow) {
  if (s.status === "anulowana" || s.status === "dostarczona") throw new HttpError(409, "Przesyłka jest zamknięta.");
}

/** The forwarder confirms a milestone (e.g. after a phone call); a later agent reading will not overwrite it. */
export async function confirmMilestone(db: Executor, sandboxId: string, shipmentId: string, milestoneId: string, at: string | null, simNow: Date) {
  const s = await shipmentOr404(db, sandboxId, shipmentId);
  assertActive(s);
  const ms = await loadMilestones(db, sandboxId, shipmentId);
  const target = ms.find((m) => m.id === milestoneId);
  if (!target) throw new HttpError(404, "Nie ma takiego etapu.");
  const when = at ? new Date(parseShipmentTime(at)) : simNow;
  if (!Number.isFinite(when.getTime())) throw new HttpError(400, "Niepoprawna data.");
  if (when.getTime() > simNow.getTime() + H) throw new HttpError(400, "Etapu nie można potwierdzić z datą w przyszłości.");
  if (when.getTime() < s.etdPlanned.getTime() - 60 * D) throw new HttpError(400, "Data zbyt odległa od planu przesyłki.");
  await db
    .update(shipmentMilestones)
    .set({ actualSim: when, source: "dispatcher", sourceMessageId: null })
    .where(and(eq(shipmentMilestones.sandboxId, sandboxId), eq(shipmentMilestones.id, milestoneId)));
  const current = ms.map((m) => (m.id === milestoneId ? { ...m, actualSim: when, source: "dispatcher" as const } : m));
  if (target.kind === "arrived" && when.getTime() !== s.etaCurrent.getTime()) await setShipment(db, sandboxId, s.id, { etaCurrent: when });
  await refreshStatus(db, sandboxId, s, current, simNow);
}

/** "Zapytaj agenta teraz" — outside the rhythm, e.g. when the client calls. */
export async function requestAgentStatusNow(db: Executor, sandboxId: string, shipmentId: string, simNow: Date) {
  const s = await shipmentOr404(db, sandboxId, shipmentId);
  assertActive(s);
  if (s.lastAgentRequestSim && s.agentAwaitingReply && simNow.getTime() - s.lastAgentRequestSim.getTime() < H) {
    throw new HttpError(409, "Zapytanie poszło przed chwilą — poczekaj na odpowiedź agenta.");
  }
  return sendAgentRequest(db, sandboxId, s, simNow, {
    reminder: false,
    by: "dispatcher",
    schedule: (dueSim, payload) =>
      scheduleEvent(db, sandboxId, {
        dueSim,
        type: "bot.shipment_agent_reply",
        payload,
      }),
  });
}

/** Facts for the client update: only what the system knows from agents and the forwarder. */
export async function clientFacts(db: Executor, sandboxId: string, s: ShipmentRow, ms: MilestoneRow[], simNow: Date): Promise<ClientUpdateFacts> {
  const [contact] = s.contactId
    ? await db
        .select()
        .from(clientContacts)
        .where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, s.contactId)))
    : [];
  const confirmed = ms.filter((m) => m.actualSim && m.kind !== "booking").sort((a, b) => a.actualSim!.getTime() - b.actualSim!.getTime());
  const last = confirmed.at(-1) ?? null;
  const delayMs = Math.max(0, s.etaCurrent.getTime() - s.etaPlanned.getTime());
  const next = ms
    .filter((m) => !m.actualSim)
    .map((m) => ({
      ...m,
      expectedMs: m.plannedSim.getTime() + (["arrived", "customs", "delivered"].includes(m.kind) ? delayMs : 0),
    }))
    .find((m) => m.expectedMs > simNow.getTime());
  return {
    number: s.number,
    clientRef: s.refs.clientRef || null,
    modeLabel: MODE_LABEL_GEN[s.mode],
    route: routeOf(s),
    destination: placeById(s.destinationId)?.name ?? s.destinationId,
    refs: refsText({ ...s.refs, clientRef: "" }, { forClient: true }),
    last: last
      ? {
          label: last.label,
          location: last.location,
          atMs: last.actualSim!.getTime(),
        }
      : null,
    next: next
      ? {
          label: next.label,
          location: next.location,
          plannedMs: next.expectedMs,
        }
      : null,
    etaMs: s.etaCurrent.getTime(),
    delayHours: etaDelayHours(s.etaPlanned.getTime(), s.etaCurrent.getTime()),
    delayReason: s.statusNote || null,
    recipientName: contact?.name ?? null,
    signature: CARRIER_SIGNATURE,
  };
}

export async function agentGuardList(db: Executor, sandboxId: string) {
  return db
    .select({
      company: agents.company,
      contactName: agents.contactName,
      email: agents.email,
    })
    .from(agents)
    .where(eq(agents.sandboxId, sandboxId));
}

/** "Przygotuj status": AI writes it from facts (template if anything is off); it waits as a draft for the forwarder. */
export async function draftClientUpdate(db: Db, sandboxId: string, shipmentId: string, simNow: Date) {
  const s = await shipmentOr404(db, sandboxId, shipmentId);
  if (s.status === "anulowana") throw new HttpError(409, "Przesyłka jest anulowana.");
  if (!s.contactId) throw new HttpError(409, "Przesyłka nie ma osoby kontaktowej klienta.");
  const ms = await loadMilestones(db, sandboxId, s.id);
  const facts = await clientFacts(db, sandboxId, s, ms, simNow);
  const outcome = await draftShipmentUpdate({
    db,
    sandboxId,
    simNow,
    facts,
    agents: await agentGuardList(db, sandboxId),
  });
  const old = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, clientThread(s.id)), eq(messages.state, "draft")));
  for (const o of old) await db.delete(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, o.id)));
  return saveDraft(db, sandboxId, {
    threadKey: clientThread(s.id),
    contactId: s.contactId,
    subject: outcome.value.subject,
    body: outcome.value.body,
    atSim: simNow,
    kind: "shipment_update",
    classifiedBy: outcome.source === "ai" ? "ai" : "rules",
  });
}

/** Sends (demo: stores) the client update. Agent names or prices typed in by hand are stopped here. */
export async function sendClientUpdate(db: Executor, sandboxId: string, shipmentId: string, draftId: string, edit: { subject: string; body: string }, simNow: Date) {
  const s = await shipmentOr404(db, sandboxId, shipmentId);
  const [m] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, draftId)));
  if (!m || m.threadKey !== clientThread(s.id)) throw new HttpError(404, "Nie ma takiego szkicu.");
  // The agent-data guard runs inside sendDraft (registered in handlers.ts), so the inbox path is covered too.
  await sendDraft(db, sandboxId, draftId, edit, simNow);
}

export async function discardClientUpdate(db: Executor, sandboxId: string, shipmentId: string, draftId: string) {
  const [m] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, draftId)));
  if (!m || m.threadKey !== clientThread(shipmentId)) throw new HttpError(404, "Nie ma takiego szkicu.");
  await discardDraft(db, sandboxId, draftId);
}

/**
 * After any client update went out (from here, the inbox or automatically): next one on the rhythm.
 * An automatic update keeps the ETA alert open — the forwarder should still see the change.
 */
export async function markClientUpdated(db: Executor, sandboxId: string, shipmentId: string, simNow: Date, opts: { automatic?: boolean } = {}) {
  const s = await loadShipment(db, sandboxId, shipmentId);
  if (!s) return;
  const active = s.status === "planowana" || s.status === "w_drodze";
  await setShipment(db, sandboxId, s.id, {
    lastClientUpdateSim: simNow,
    nextClientUpdateSim: active ? new Date(simNow.getTime() + s.clientEveryHours * H) : null,
  });
  await resolveAlerts(db, sandboxId, `shipment:${s.id}:client`, simNow);
  if (!opts.automatic) await resolveAlerts(db, sandboxId, `shipment:${s.id}:eta`, simNow);
}

export const ShipmentSettingsSchema = z.object({
  agentEveryHours: z.number().int().min(4, "Agenta pytamy najczęściej co 4 h.").max(168, "Agenta pytamy co najmniej raz w tygodniu.").optional(),
  clientEveryHours: z.number().int().min(4, "Status dla klienta najczęściej co 4 h.").max(168, "Status dla klienta co najmniej raz w tygodniu.").optional(),
  autoClientUpdates: z.boolean().optional(),
});

export async function updateShipmentSettings(db: Executor, sandboxId: string, shipmentId: string, raw: z.input<typeof ShipmentSettingsSchema>, simNow: Date) {
  const patch = parse(ShipmentSettingsSchema, raw);
  const s = await shipmentOr404(db, sandboxId, shipmentId);
  assertActive(s);
  const set: Partial<typeof shipments.$inferInsert> = { ...patch };
  if (patch.clientEveryHours && patch.clientEveryHours !== s.clientEveryHours) {
    set.nextClientUpdateSim = new Date((s.lastClientUpdateSim ?? simNow).getTime() + patch.clientEveryHours * H);
  }
  if (Object.keys(set).length) await setShipment(db, sandboxId, s.id, set);
}

export async function cancelShipment(db: Executor, sandboxId: string, shipmentId: string, simNow: Date) {
  const s = await shipmentOr404(db, sandboxId, shipmentId);
  assertActive(s);
  await setShipment(db, sandboxId, s.id, {
    status: "anulowana",
    agentAwaitingReply: false,
    nextClientUpdateSim: null,
  });
  await resolveAlerts(db, sandboxId, `shipment:${s.id}:`, simNow);
}

/** Prefill for "Utwórz przesyłkę" on a won sea/air/rail quote. */
export async function shipmentDraftFromQuote(db: Executor, sandboxId: string, quoteId: string) {
  const [q] = await db
    .select()
    .from(quoteRequests)
    .where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, quoteId)));
  if (!q) throw new HttpError(404, "Nie ma takiej wyceny.");
  if (q.mode === "road") throw new HttpError(409, "Przesyłki dotyczą transportu morskiego, lotniczego i kolejowego.");
  const [aq] = q.selectedQuoteId
    ? await db
        .select()
        .from(agentQuotes)
        .where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.id, q.selectedQuoteId)))
    : [];
  return { quote: q, agentId: aq?.agentId ?? null };
}
