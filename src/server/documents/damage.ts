import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { assessDamage } from "@/ai/functions/assess-damage";
import { clientContacts, damageCases, documents, messages, orders, points } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { DAMAGE_KIND_LABEL, damageChecklist, type DamageKind, type DamageStep } from "@/domain/damage-case";
import { formatWarsaw } from "@/lib/format";
import { HttpError } from "../http";
import { emailThread, saveDraft } from "../inbox/gateway";

export type DamageCaseView = {
  id: string;
  kind: DamageKind;
  kindLabel: string;
  affected: string | null;
  summary: string;
  steps: (DamageStep & { done: boolean })[];
  notes: string[];
  /** The e-mail to the client waiting in Skrzynka: its thread, and whether it is still a draft. */
  mail: { rootId: string; state: "draft" | "sent" } | null;
  /** Who classified the remark and who worded the e-mail (a risky AI draft is replaced by the template). */
  source: "ai" | "rules";
  mailFrom: "ai" | "szablon";
  createdSim: string;
};

type CaseRow = typeof damageCases.$inferSelect;

async function toView(db: Executor, sandboxId: string, row: CaseRow): Promise<DamageCaseView> {
  const [mail] = row.draftMessageId ? await db.select({ id: messages.id, state: messages.state }).from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, row.draftMessageId))) : [];
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: DAMAGE_KIND_LABEL[row.kind],
    affected: row.affected,
    summary: row.summary,
    steps: row.steps.map((s) => ({ ...s, done: row.doneSteps.includes(s.id) })),
    notes: row.notes,
    mail: mail ? { rootId: mail.id, state: mail.state === "draft" ? "draft" : "sent" } : null,
    source: row.source,
    mailFrom: row.mailFrom,
    createdSim: row.createdSim.toISOString(),
  };
}

/** Damage cases of the given documents, keyed by document. */
export async function damageCasesFor(db: Executor, sandboxId: string, documentIds: string[]): Promise<Map<string, DamageCaseView>> {
  const result = new Map<string, DamageCaseView>();
  if (documentIds.length === 0) return result;
  const rows = await db.select().from(damageCases).where(and(eq(damageCases.sandboxId, sandboxId), inArray(damageCases.documentId, documentIds)));
  for (const row of rows) result.set(row.documentId, await toView(db, sandboxId, row));
  return result;
}

/**
 * "Przygotuj zgłoszenie szkody": from the consignee's remark on a CMR matched to an order — the kind
 * of reservation, a checklist with the deadlines that apply, and a draft e-mail to the client in Skrzynka.
 * Nothing is sent: the draft waits for the dispatcher like every other one.
 */
export async function prepareDamageCase(db: Db, sandboxId: string, documentId: string, simNow: Date): Promise<DamageCaseView> {
  const [doc] = await db.select().from(documents).where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, documentId)));
  if (!doc) throw new HttpError(404, "Nie ma takiego dokumentu.");
  const remark = doc.quality?.remarks?.trim();
  if (!remark) throw new HttpError(409, "Na tym dokumencie nie ma adnotacji odbiorcy.");
  if (!doc.matchedOrderId) throw new HttpError(409, "Najpierw przypisz dokument do zlecenia.");
  const [existing] = await db.select().from(damageCases).where(and(eq(damageCases.sandboxId, sandboxId), eq(damageCases.documentId, documentId)));
  if (existing) return toView(db, sandboxId, existing);

  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, doc.matchedOrderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  const stops = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), inArray(points.id, [order.pickupPointId, order.deliveryPointId])));
  const pickup = stops.find((p) => p.id === order.pickupPointId);
  const delivery = stops.find((p) => p.id === order.deliveryPointId);
  const delivered = order.unloadedAt ?? order.arrivedDeliveryAt;
  const facts = {
    orderNumber: order.number,
    references: order.references,
    route: `${pickup?.city ?? "?"} → ${delivery?.city ?? "?"}`,
    deliveredOn: delivered ? formatWarsaw(delivered, "dd.MM.yyyy") : null,
    remark,
    stamp: doc.quality?.stamp ?? null,
    signature: doc.quality?.signature ?? null,
  };
  const assessment = await assessDamage({ db, sandboxId, simNow, facts });
  const a = assessment.value;
  const international = Boolean(pickup && delivery && pickup.country !== delivery.country);
  const { steps, notes } = damageChecklist(a.kind, international);

  // The e-mail goes to the client's first contact person as a new thread in Skrzynka, as a draft.
  const [contact] = await db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.clientId, order.clientId))).orderBy(asc(clientContacts.id));
  let draftMessageId: string | null = null;
  if (contact) {
    draftMessageId = await saveDraft(db, sandboxId, {
      threadKey: emailThread(randomUUID()),
      contactId: contact.id,
      subject: a.mailSubject,
      body: a.mailBody,
      atSim: simNow,
      orderId: order.id,
      kind: "draft_damage",
      classifiedBy: assessment.mailFrom === "ai" ? "ai" : "rules",
    });
    // A composed thread is keyed by its first message, like an inbound one.
    await db.update(messages).set({ threadKey: emailThread(draftMessageId) }).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, draftMessageId)));
  }

  const row: CaseRow = {
    sandboxId,
    id: randomUUID(),
    documentId,
    orderId: order.id,
    kind: a.kind,
    affected: a.affected,
    summary: a.summary,
    remark,
    steps,
    doneSteps: [],
    notes: contact ? notes : ["Klient nie ma osoby kontaktowej: szkic maila nie powstał. Dodaj osobę w Klientach.", ...notes],
    draftMessageId,
    source: assessment.source === "ai" ? "ai" : "rules",
    mailFrom: assessment.mailFrom,
    createdSim: simNow,
  };
  await db.insert(damageCases).values(row);
  return toView(db, sandboxId, row);
}

/** Ticks a checklist step on or off. */
export async function setDamageStep(db: Executor, sandboxId: string, documentId: string, stepId: string, done: boolean): Promise<DamageCaseView> {
  const [row] = await db.select().from(damageCases).where(and(eq(damageCases.sandboxId, sandboxId), eq(damageCases.documentId, documentId)));
  if (!row) throw new HttpError(404, "Dla tego dokumentu nie ma zgłoszenia szkody.");
  if (!row.steps.some((s) => s.id === stepId)) throw new HttpError(400, "Nie ma takiego kroku.");
  const doneSteps = done ? [...new Set([...row.doneSteps, stepId])] : row.doneSteps.filter((id) => id !== stepId);
  await db.update(damageCases).set({ doneSteps }).where(and(eq(damageCases.sandboxId, sandboxId), eq(damageCases.id, row.id)));
  return toView(db, sandboxId, { ...row, doneSteps });
}
