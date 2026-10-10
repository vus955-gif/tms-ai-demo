import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { orders, orderStatusChanges, type OrderStatus, type StatusActor } from "@/db/schema";
import type { Executor } from "@/db/types";
import { TransitionError, transitionError } from "@/domain/order-lifecycle";

type OrderPatch = Partial<typeof orders.$inferInsert>;

/** Validates and records one status change (spec §8). Throws TransitionError when not allowed. */
export async function transitionOrder(
  db: Executor,
  sandboxId: string,
  order: { id: string; status: OrderStatus },
  to: OrderStatus,
  actor: StatusActor,
  reason: string,
  atSim: Date,
  patch: OrderPatch = {},
): Promise<void> {
  const problem = transitionError(order.status, to, actor);
  if (problem) throw new TransitionError(problem);
  const updated = await db
    .update(orders)
    .set({ ...patch, status: to })
    .where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning({ id: orders.id });
  if (updated.length === 0) throw new TransitionError("Zlecenie zmieniło się w międzyczasie. Odśwież widok.");
  await db.insert(orderStatusChanges).values({
    sandboxId,
    id: randomUUID(),
    orderId: order.id,
    fromStatus: order.status,
    toStatus: to,
    actor,
    reason,
    atSim,
  });
}
