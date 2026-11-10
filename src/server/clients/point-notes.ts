import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { drivers, messages, orders, pointNoteSuggestions, points, type OrderStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import { HttpError } from "../http";

/**
 * "Wiedza o punktach": drivers know the places best. What they write about a loading or unloading
 * place is proposed as a note for that point; once the dispatcher accepts it, the note goes out in
 * the order SMS and on the driver's page for everyone who drives there next.
 */

const TO_PICKUP: OrderStatus[] = ["WYSLANE", "POTWIERDZONE", "ZALADUNEK"];
const TO_DELIVERY: OrderStatus[] = ["W_DRODZE", "ROZLADUNEK", "DO_ZAMKNIECIA"];
const MAX_NOTES = 600;

export type PointSuggestion = { id: string; text: string; source: "ai" | "rules"; driverName: string; quote: string; createdSim: string };

/** Which point a driver's remark is about: the stop the model named, or the one the driver is heading to / standing at. */
async function pointFor(db: Executor, sandboxId: string, driverId: string, stop: "zaladunek" | "rozladunek" | null): Promise<string | null> {
  const own = await db
    .select({ status: orders.status, pickupPointId: orders.pickupPointId, deliveryPointId: orders.deliveryPointId })
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), eq(orders.driverId, driverId)))
    .orderBy(desc(orders.createdSim));
  const order = own.find((o) => TO_DELIVERY.includes(o.status)) ?? own.find((o) => TO_PICKUP.includes(o.status));
  if (!order) return null;
  if (stop) return stop === "zaladunek" ? order.pickupPointId : order.deliveryPointId;
  return TO_DELIVERY.includes(order.status) ? order.deliveryPointId : order.pickupPointId;
}

export async function suggestPointNote(
  db: Executor,
  sandboxId: string,
  input: { driverId: string; messageId: string; text: string; stop: "zaladunek" | "rozladunek" | null; source: "ai" | "rules"; atSim: Date },
): Promise<string | null> {
  const pointId = await pointFor(db, sandboxId, input.driverId, input.stop);
  if (!pointId) return null;
  const [point] = await db.select({ kind: points.kind, notes: points.notes }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.id, pointId)));
  // Only clients' places: the carrier's own bases are not "site knowledge" to collect from SMS.
  if (!point || point.kind !== "client") return null;
  const [same] = await db.select({ id: pointNoteSuggestions.id }).from(pointNoteSuggestions).where(and(eq(pointNoteSuggestions.sandboxId, sandboxId), eq(pointNoteSuggestions.messageId, input.messageId)));
  if (same) return same.id;
  const id = randomUUID();
  await db.insert(pointNoteSuggestions).values({ sandboxId, id, pointId, text: input.text, messageId: input.messageId, driverId: input.driverId, source: input.source, createdSim: input.atSim });
  return id;
}

/** Open proposals per point, newest first, with who wrote what. */
export async function openPointSuggestions(db: Executor, sandboxId: string): Promise<Map<string, PointSuggestion[]>> {
  const rows = await db
    .select({
      id: pointNoteSuggestions.id,
      pointId: pointNoteSuggestions.pointId,
      text: pointNoteSuggestions.text,
      source: pointNoteSuggestions.source,
      createdSim: pointNoteSuggestions.createdSim,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      quote: messages.body,
    })
    .from(pointNoteSuggestions)
    .innerJoin(drivers, and(eq(drivers.sandboxId, pointNoteSuggestions.sandboxId), eq(drivers.id, pointNoteSuggestions.driverId)))
    .innerJoin(messages, and(eq(messages.sandboxId, pointNoteSuggestions.sandboxId), eq(messages.id, pointNoteSuggestions.messageId)))
    .where(and(eq(pointNoteSuggestions.sandboxId, sandboxId), eq(pointNoteSuggestions.status, "nowa")))
    .orderBy(desc(pointNoteSuggestions.createdSim));
  const byPoint = new Map<string, PointSuggestion[]>();
  for (const r of rows) {
    const list = byPoint.get(r.pointId) ?? [];
    list.push({ id: r.id, text: r.text, source: r.source, driverName: `${r.firstName} ${r.lastName}`, quote: r.quote, createdSim: r.createdSim.toISOString() });
    byPoint.set(r.pointId, list);
  }
  return byPoint;
}

export async function openPointSuggestionsCount(db: Executor, sandboxId: string): Promise<number> {
  const [{ value }] = await db.select({ value: count() }).from(pointNoteSuggestions).where(and(eq(pointNoteSuggestions.sandboxId, sandboxId), eq(pointNoteSuggestions.status, "nowa")));
  return value;
}

/** Accept (optionally reworded by the dispatcher) → appended to the point's notes; reject → nothing changes. */
export async function decidePointSuggestion(db: Executor, sandboxId: string, pointId: string, input: { suggestionId: string; action: "accept" | "reject"; text?: string }, simNow: Date) {
  const [s] = await db
    .select()
    .from(pointNoteSuggestions)
    .where(and(eq(pointNoteSuggestions.sandboxId, sandboxId), eq(pointNoteSuggestions.id, input.suggestionId), eq(pointNoteSuggestions.pointId, pointId)));
  if (!s) throw new HttpError(404, "Nie ma takiej propozycji.");
  if (s.status !== "nowa") throw new HttpError(409, "Ta propozycja została już rozpatrzona.");
  if (input.action === "accept") {
    const text = (input.text ?? s.text).trim().replace(/\s+/g, " ");
    if (!text) throw new HttpError(400, "Uwaga nie może być pusta.");
    const [point] = await db.select({ notes: points.notes }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.id, pointId)));
    if (!point) throw new HttpError(404, "Nie ma takiego punktu.");
    const sentence = /[.!?…]$/.test(text) ? text : `${text}.`;
    const notes = [point.notes.trim(), sentence].filter(Boolean).join(" ");
    if (notes.length > MAX_NOTES) throw new HttpError(400, `Uwagi punktu byłyby za długie (najwyżej ${MAX_NOTES} znaków). Skróć tę albo wcześniejsze uwagi.`);
    await db.update(points).set({ notes }).where(and(eq(points.sandboxId, sandboxId), eq(points.id, pointId)));
  }
  await db
    .update(pointNoteSuggestions)
    .set({ status: input.action === "accept" ? "przyjeta" : "odrzucona", decidedSim: simNow })
    .where(and(eq(pointNoteSuggestions.sandboxId, sandboxId), eq(pointNoteSuggestions.id, s.id)));
}
