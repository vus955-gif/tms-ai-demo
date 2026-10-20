import { and, asc, desc, eq } from "drizzle-orm";
import { agentQuotes, agents, clientContacts, clients, messages, quoteRequests, shipments, type AgentQuoteStatus, type QuoteMode, type QuoteStatus, type RoadRate } from "@/db/schema";
import type { Executor } from "@/db/types";
import { EMPTY_DETAILS, type QuoteDetails } from "@/domain/quote-rules";
import { offerPrice, type RoadCalculation } from "@/domain/sales-pricing";
import { HttpError } from "../http";
import { loadSettings, routeText } from "./quotes";

export type QuoteListItem = {
  id: string;
  number: string;
  mode: QuoteMode;
  status: QuoteStatus;
  clientName: string;
  route: string;
  createdSim: string;
  deadlineSim: string | null;
  sent: number;
  answered: number;
  bestPrice: { amount: number; currency: string } | null;
};

export type ThreadEntry = { id: string; direction: "in" | "out"; state: string; subject: string; body: string; atSim: string; kind: string | null; classifiedBy: string | null };

export type AgentRow = {
  agentQuoteId: string;
  agentId: string;
  company: string;
  contactName: string;
  status: AgentQuoteStatus;
  price: number | null;
  currency: string | null;
  validUntil: string | null;
  transitDays: number | null;
  conditions: string | null;
  readBy: string | null;
  thread: ThreadEntry[];
};

export type QuoteDetailView = {
  id: string;
  number: string;
  mode: QuoteMode;
  status: QuoteStatus;
  client: { id: string; name: string };
  contact: { name: string; email: string };
  source: { rootId: string; subject: string; body: string; atSim: string } | null;
  details: QuoteDetails;
  missing: string[];
  extractedBy: "ai" | "rules";
  deadlineSim: string | null;
  agents: AgentRow[];
  selectedQuoteId: string | null;
  marginPct: number | null;
  defaultMarginPct: number;
  offer: { purchase: number; price: number; currency: string } | null;
  calculation: (RoadCalculation & { kmLabel?: string; kmOverride?: number | null }) | null;
  clientThread: ThreadEntry[];
  /** The sea/air/rail shipment created from this won quote, if any. */
  shipment: { id: string; number: string } | null;
};

const entry = (m: typeof messages.$inferSelect): ThreadEntry => ({
  id: m.id,
  direction: m.direction,
  state: m.state,
  subject: m.subject ?? "",
  body: m.body,
  atSim: m.atSim.toISOString(),
  kind: m.kind,
  classifiedBy: m.classifiedBy,
});

export async function listQuotes(db: Executor, sandboxId: string): Promise<QuoteListItem[]> {
  const [rows, aqs, cls] = await Promise.all([
    db.select().from(quoteRequests).where(eq(quoteRequests.sandboxId, sandboxId)).orderBy(desc(quoteRequests.createdSim)),
    db.select().from(agentQuotes).where(eq(agentQuotes.sandboxId, sandboxId)),
    db.select().from(clients).where(eq(clients.sandboxId, sandboxId)),
  ]);
  return rows.map((q) => {
    const own = aqs.filter((a) => a.requestId === q.id);
    const priced = own.filter((a) => a.status === "odpowiedz" && a.price !== null).sort((a, b) => a.price! - b.price!);
    const calc = q.calculation as RoadCalculation | null;
    return {
      id: q.id,
      number: q.number,
      mode: q.mode,
      status: q.status,
      clientName: cls.find((c) => c.id === q.clientId)?.name ?? "",
      route: routeText({ ...EMPTY_DETAILS, ...(q.details as Partial<QuoteDetails>) }),
      createdSim: q.createdSim.toISOString(),
      deadlineSim: q.deadlineSim?.toISOString() ?? null,
      sent: own.length,
      answered: own.filter((a) => ["odpowiedz", "brak_miejsca"].includes(a.status)).length,
      bestPrice: q.mode === "road" ? (calc ? { amount: calc.price, currency: calc.currency } : null) : priced[0] ? { amount: priced[0].price!, currency: priced[0].currency ?? "" } : null,
    };
  });
}

export async function quoteDetail(db: Executor, sandboxId: string, id: string): Promise<QuoteDetailView> {
  const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandboxId), eq(quoteRequests.id, id)));
  if (!q) throw new HttpError(404, "Nie ma takiej wyceny.");
  const [client] = await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, q.clientId)));
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.id, q.contactId)));
  const [src] = q.sourceMessageId ? await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, q.sourceMessageId))) : [];
  const clientThread = src ? await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.threadKey, src.threadKey))).orderBy(asc(messages.atSim)) : [];
  const aqs = await db.select().from(agentQuotes).where(and(eq(agentQuotes.sandboxId, sandboxId), eq(agentQuotes.requestId, id)));
  const agentRows = await db.select().from(agents).where(eq(agents.sandboxId, sandboxId));
  const agentMsgs = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.party, "agent"))).orderBy(asc(messages.atSim));
  const settings = await loadSettings(db, sandboxId);
  const selected = aqs.find((a) => a.id === q.selectedQuoteId);
  const [shipment] = await db.select({ id: shipments.id, number: shipments.number }).from(shipments).where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.quoteId, q.id)));
  return {
    shipment: shipment ?? null,
    id: q.id,
    number: q.number,
    mode: q.mode,
    status: q.status,
    client: { id: client.id, name: client.name },
    contact: { name: contact.name, email: contact.email },
    source: src ? { rootId: src.id, subject: src.subject ?? "", body: src.body, atSim: src.atSim.toISOString() } : null,
    details: { ...EMPTY_DETAILS, ...(q.details as Partial<QuoteDetails>) },
    missing: q.missingFields,
    extractedBy: q.extractedBy,
    deadlineSim: q.deadlineSim?.toISOString() ?? null,
    agents: aqs
      .map((a) => {
        const agent = agentRows.find((x) => x.id === a.agentId)!;
        return {
          agentQuoteId: a.id,
          agentId: a.agentId,
          company: agent.company,
          contactName: agent.contactName,
          status: a.status,
          price: a.price,
          currency: a.currency,
          validUntil: a.validUntil,
          transitDays: a.transitDays,
          conditions: a.conditions,
          readBy: a.readBy,
          thread: agentMsgs.filter((m) => m.threadKey === `rfq:${q.id}:${a.agentId}`).map(entry),
        };
      })
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
    selectedQuoteId: q.selectedQuoteId,
    marginPct: q.marginPct,
    defaultMarginPct: settings.defaultMarginPct,
    offer: selected?.price && q.marginPct !== null ? { purchase: selected.price, price: offerPrice(selected.price, q.marginPct), currency: selected.currency ?? "" } : null,
    calculation: q.calculation as QuoteDetailView["calculation"],
    clientThread: clientThread.map(entry),
  };
}

export type SalesSettingsView = {
  autoSend: boolean;
  defaultMarginPct: number;
  adrSurchargePct: number;
  reeferSurchargePct: number;
  roadRates: RoadRate[];
  agents: { id: string; company: string; contactName: string; email: string; modes: QuoteMode[]; regions: string; active: boolean }[];
};

export async function salesSettingsView(db: Executor, sandboxId: string): Promise<SalesSettingsView> {
  const s = await loadSettings(db, sandboxId);
  const list = await db.select().from(agents).where(eq(agents.sandboxId, sandboxId)).orderBy(asc(agents.company));
  return {
    autoSend: s.autoSend,
    defaultMarginPct: s.defaultMarginPct,
    adrSurchargePct: s.adrSurchargePct,
    reeferSurchargePct: s.reeferSurchargePct,
    roadRates: s.roadRates,
    agents: list.map((a) => ({ id: a.id, company: a.company, contactName: a.contactName, email: a.email, modes: a.modes, regions: a.regions, active: a.active })),
  };
}
