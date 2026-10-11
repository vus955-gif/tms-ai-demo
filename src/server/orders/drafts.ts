import { and, eq } from "drizzle-orm";
import { orders, points } from "@/db/schema";
import type { Executor } from "@/db/types";
import { HttpError } from "../http";
import { NewOrderSchema, type NewOrder } from "./create";
import { transitionOrder } from "./transition";

async function loadDraft(db: Executor, sandboxId: string, orderId: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  if (order.status !== "SZKIC") throw new HttpError(409, "To zlecenie nie jest już szkicem.");
  return order;
}

/** Dispatcher approves an e-mail draft (optionally corrected): SZKIC → NOWE. */
export async function approveDraftOrder(db: Executor, sandboxId: string, orderId: string, edited: unknown | null, simNow: Date) {
  const order = await loadDraft(db, sandboxId, orderId);
  let patch: Partial<typeof orders.$inferInsert> = {};
  if (edited) {
    const parsed = NewOrderSchema.safeParse(edited);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
    const v: NewOrder = parsed.data;
    if (v.clientId !== order.clientId) throw new HttpError(400, "Szkic z maila należy do klienta, który go przysłał.");
    const own = await db.select({ id: points.id }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, order.clientId)));
    if (![v.pickupPointId, v.deliveryPointId].every((id) => own.some((p) => p.id === id))) throw new HttpError(400, "Punkt nie należy do klienta.");
    patch = {
      pickupPointId: v.pickupPointId,
      deliveryPointId: v.deliveryPointId,
      pickupFrom: new Date(v.pickupFrom),
      pickupTo: new Date(v.pickupTo),
      deliveryFrom: new Date(v.deliveryFrom),
      deliveryTo: new Date(v.deliveryTo),
      cargoPallets: v.cargoPallets,
      cargoKg: v.cargoKg,
      bodyRequired: v.bodyRequired,
      adrRequired: v.adrRequired,
      references: v.references,
      notes: v.notes,
      etd: new Date(v.pickupTo),
      etaAgreed: new Date(v.deliveryTo),
    };
  }
  await transitionOrder(db, sandboxId, order, "NOWE", "dispatcher", edited ? "Szkic z maila zatwierdzony z poprawkami" : "Szkic z maila zatwierdzony", simNow, patch);
  return { number: order.number };
}

export async function rejectDraftOrder(db: Executor, sandboxId: string, orderId: string, simNow: Date) {
  const order = await loadDraft(db, sandboxId, orderId);
  await transitionOrder(db, sandboxId, order, "ANULOWANE", "dispatcher", "Szkic z maila odrzucony", simNow);
}
