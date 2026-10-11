import { and, eq } from "drizzle-orm";
import { aiLog, documents, orders, type OrderStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import { resolveAlerts } from "./alerts/repository";
import { HttpError } from "./http";
import { transitionOrder } from "./orders/transition";

/**
 * Status changes made on an AI decision are written into the AI log entry that
 * produced them, so the dispatcher can undo them from the AI log (spec §11).
 */
export type AiAction = { type: "status"; orderId: string; number: string; from: OrderStatus; to: OrderStatus; documentId?: string };

const UNDOABLE: Partial<Record<OrderStatus, OrderStatus>> = {
  // A confirmation the AI read wrongly goes back to "waiting for the driver".
  POTWIERDZONE: "WYSLANE",
  // A CMR matched to the wrong order goes back to unloading; the document waits for a human.
  DO_ZAMKNIECIA: "ROZLADUNEK",
};

export function parseAiAction(text: string | null): AiAction | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as AiAction;
    return value?.type === "status" ? value : null;
  } catch {
    return null;
  }
}

export async function recordAiAction(db: Executor, sandboxId: string, logId: string, action: AiAction) {
  await db
    .update(aiLog)
    .set({ actionTaken: JSON.stringify(action) })
    .where(and(eq(aiLog.sandboxId, sandboxId), eq(aiLog.id, logId)));
}

export async function revertAiAction(db: Executor, sandboxId: string, logId: string, simNow: Date) {
  const [entry] = await db.select().from(aiLog).where(and(eq(aiLog.sandboxId, sandboxId), eq(aiLog.id, logId)));
  if (!entry) throw new HttpError(404, "Nie ma takiego wpisu w dzienniku AI.");
  if (entry.reverted) throw new HttpError(409, "Ta decyzja AI została już cofnięta.");
  const action = parseAiAction(entry.actionTaken);
  const back = action ? UNDOABLE[action.to] : undefined;
  if (!action || !back) throw new HttpError(409, "Tej decyzji AI nie da się cofnąć.");
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, action.orderId)));
  if (!order || order.status !== action.to) throw new HttpError(409, `Zlecenie ${action.number} zmieniło już status — cofnięcie nie jest możliwe.`);
  if (action.documentId) {
    const [doc] = await db.select().from(documents).where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, action.documentId)));
    if (!doc || doc.status !== "do_zamkniecia" || doc.matchedOrderId !== order.id) {
      throw new HttpError(409, "Ten dokument nie jest już dopasowany do zlecenia — cofnięcie nie jest możliwe.");
    }
  }
  await transitionOrder(db, sandboxId, order, back, "dispatcher", "Cofnięta decyzja AI (Dziennik AI)", simNow);
  if (action.documentId) {
    await db
      .update(documents)
      .set({ status: "do_weryfikacji", matchedOrderId: null, decidedBy: "dispatcher", decidedAtSim: simNow, note: "Dopasowanie AI cofnięte przez spedytora." })
      .where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, action.documentId)));
    await resolveAlerts(db, sandboxId, `cmr:${action.documentId}`, simNow);
  }
  await db.update(aiLog).set({ reverted: true }).where(and(eq(aiLog.sandboxId, sandboxId), eq(aiLog.id, logId)));
}

export const isUndoable = (action: AiAction | null) => Boolean(action && UNDOABLE[action.to]);
