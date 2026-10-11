import { and, eq, inArray } from "drizzle-orm";
import { points } from "@/db/schema";
import type { Executor } from "@/db/types";

/** "Gądki → Leipzig" */
export async function routeLabelFor(db: Executor, sandboxId: string, order: { pickupPointId: string; deliveryPointId: string }): Promise<string> {
  const pts = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), inArray(points.id, [order.pickupPointId, order.deliveryPointId])));
  const city = (id: string) => pts.find((p) => p.id === id)?.city ?? id;
  return `${city(order.pickupPointId)} → ${city(order.deliveryPointId)}`;
}
