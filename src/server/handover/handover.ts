import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { writeHandover } from "@/ai/functions/write-handover";
import { clients, documents, driverAbsences, drivers, handovers, messages, orders, points } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { ABSENCE_LABEL } from "@/domain/fleet-terms";
import { handoverSections, type HandoverFacts, type HandoverSection } from "@/domain/handover";
import { windowText } from "@/domain/sms-templates";
import { formatSimClock, formatWarsaw } from "@/lib/format";
import { listAlerts } from "../alerts/repository";
import { openPointSuggestionsCount } from "../clients/point-notes";
import { fleetFile } from "../fleet/views";
import { HttpError } from "../http";
import { unreadClientEmails } from "../inbox/gateway";
import { shipmentsAttentionCount } from "../shipments/views";

const DAY = 86_400_000;
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

/** Everything the next shift must know, read from the current state of the world. */
export async function handoverFacts(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }, simNow: Date): Promise<HandoverFacts> {
  const sandboxId = sandbox.id;
  const [alertRows, orderRows, driverRows, pointRows, clientRows, docRows, absenceRows, fleet, [{ value: replyDrafts }]] = await Promise.all([
    listAlerts(db, sandboxId, { limit: 50 }),
    db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), inArray(orders.status, ["SZKIC", "NOWE", "PRZYPISANE", "WYSLANE", "POTWIERDZONE", "ZALADUNEK", "W_DRODZE", "ROZLADUNEK"]))),
    db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName }).from(drivers).where(eq(drivers.sandboxId, sandboxId)),
    db.select({ id: points.id, city: points.city }).from(points).where(eq(points.sandboxId, sandboxId)),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.sandboxId, sandboxId)),
    db.select({ status: documents.status }).from(documents).where(eq(documents.sandboxId, sandboxId)),
    db.select().from(driverAbsences).where(eq(driverAbsences.sandboxId, sandboxId)),
    fleetFile(db, sandbox, simNow),
    db.select({ value: count() }).from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.party, "client"), eq(messages.state, "draft"))),
  ]);
  const driverName = (id: string | null) => {
    const d = driverRows.find((x) => x.id === id);
    return d ? `${d.firstName} ${d.lastName}` : "bez kierowcy";
  };
  const city = (id: string) => pointRows.find((p) => p.id === id)?.city ?? "?";
  const route = (o: { pickupPointId: string; deliveryPointId: string }) => `${city(o.pickupPointId)} → ${city(o.deliveryPointId)}`;
  const byPickup = <T extends { pickupFrom: Date }>(list: T[]) => [...list].sort((a, b) => a.pickupFrom.getTime() - b.pickupFrom.getTime());

  return {
    at: formatSimClock(simNow),
    alerts: alertRows
      .filter((a) => a.severity !== "info")
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.createdSim.getTime() - a.createdSim.getTime())
      .slice(0, 8)
      .map((a) => ({ severity: a.severity, title: a.title, body: a.body })),
    atRisk: orderRows
      .filter((o): o is typeof o & { risk: "red" | "yellow" } => o.risk === "red" || o.risk === "yellow")
      .sort((a, b) => (a.risk === b.risk ? a.deliveryTo.getTime() - b.deliveryTo.getTime() : a.risk === "red" ? -1 : 1))
      .map((o) => ({ number: o.number, route: route(o), driver: driverName(o.driverId), risk: o.risk, eta: o.etaPredicted ? formatSimClock(o.etaPredicted) : null, deadline: formatSimClock(o.deliveryTo) })),
    unconfirmed: byPickup(orderRows.filter((o) => o.status === "WYSLANE")).map((o) => ({ number: o.number, driver: driverName(o.driverId), pickup: windowText(o.pickupFrom, o.pickupTo) })),
    unassigned: byPickup(orderRows.filter((o) => o.status === "NOWE")).map((o) => ({ number: o.number, client: clientRows.find((c) => c.id === o.clientId)?.name ?? "", pickup: windowText(o.pickupFrom, o.pickupTo) })),
    drafts: orderRows.filter((o) => o.status === "SZKIC").length,
    documents: {
      toClose: docRows.filter((d) => d.status === "do_zamkniecia").length,
      toVerify: docRows.filter((d) => d.status === "do_weryfikacji").length,
      illegible: docRows.filter((d) => d.status === "nieczytelny").length,
    },
    inbox: { unread: await unreadClientEmails(db, sandboxId), replyDrafts },
    shipmentsDue: await shipmentsAttentionCount(db, sandboxId, simNow),
    fleet: {
      overdue: [...fleet.vehicles, ...fleet.trailers, ...fleet.drivers].flatMap((s) => s.terms.filter((t) => t.status === "po_terminie").map((t) => `${s.title}: ${t.label}${t.blocking ? " (blokuje przydział)" : ""}`)),
      soon: fleet.soon,
    },
    // Who will be missing over the next two days: the next shift plans around it.
    absences: absenceRows
      .filter((a) => a.toSim > simNow && a.fromSim.getTime() < simNow.getTime() + 2 * DAY)
      .sort((a, b) => a.fromSim.getTime() - b.fromSim.getTime())
      .map((a) => ({ driver: driverName(a.driverId), label: ABSENCE_LABEL[a.kind], from: formatWarsaw(a.fromSim, "d.MM") })),
    pointSuggestions: await openPointSuggestionsCount(db, sandboxId),
  };
}

export type HandoverNote = { id: string; body: string; source: "ai" | "rules" | "reczna"; createdSim: string };
export type HandoverView = { at: string; sections: HandoverSection[]; history: HandoverNote[] };

export async function handoverView(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }, simNow: Date): Promise<HandoverView> {
  const facts = await handoverFacts(db, sandbox, simNow);
  const rows = await db.select().from(handovers).where(eq(handovers.sandboxId, sandbox.id)).orderBy(desc(handovers.createdSim)).limit(5);
  return { at: facts.at, sections: handoverSections(facts), history: rows.map((h) => ({ id: h.id, body: h.body, source: h.source, createdSim: h.createdSim.toISOString() })) };
}

/** "Przygotuj notatkę": a draft from the facts as they are right now. Not saved. */
export async function draftHandover(db: Db, sandbox: { id: string; simOrigin: Date; seed: number }, simNow: Date): Promise<{ note: string; source: "ai" | "fallback" }> {
  return writeHandover({ db, sandboxId: sandbox.id, simNow, facts: await handoverFacts(db, sandbox, simNow) });
}

/** "Zapisz przekazanie": the note as the outgoing dispatcher left it, with the facts it was written from. */
export async function saveHandover(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }, input: { body: string; source: "ai" | "rules" | "reczna" }, simNow: Date): Promise<HandoverNote> {
  const body = input.body.trim();
  if (body.length < 10) throw new HttpError(400, "Notatka jest za krótka. Napisz choć jedno zdanie dla następnej zmiany.");
  const row = { sandboxId: sandbox.id, id: randomUUID(), body: body.slice(0, 3000), facts: await handoverFacts(db, sandbox, simNow), source: input.source, createdSim: simNow };
  await db.insert(handovers).values(row);
  return { id: row.id, body: row.body, source: row.source, createdSim: simNow.toISOString() };
}
