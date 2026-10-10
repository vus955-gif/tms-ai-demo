import { eq } from "drizzle-orm";
import { orders } from "@/db/schema";
import type { Executor } from "@/db/types";

/** Next "ZL-xxxx" number within one world. */
export async function nextOrderNumber(db: Executor, sandboxId: string): Promise<string> {
  const rows = await db.select({ number: orders.number }).from(orders).where(eq(orders.sandboxId, sandboxId));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.replace(/\D/g, "")) || 0), 1000);
  return `ZL-${max + 1}`;
}
