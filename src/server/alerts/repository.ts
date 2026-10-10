import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { alerts, type AlertAction, type AlertSeverity } from "@/db/schema";
import type { Executor } from "@/db/types";

export type AlertRow = typeof alerts.$inferSelect;

export type AlertInput = {
  kind: string;
  severity: AlertSeverity;
  dedupeKey: string;
  title: string;
  body: string;
  actions: AlertAction[];
  facts: Record<string, unknown>;
  vehicleId?: string | null;
  orderId?: string | null;
  driverId?: string | null;
  incidentId?: string | null;
  messageId?: string | null;
};

/** Opens an alert unless one with the same dedupe key is already open. */
export async function openAlert(
  db: Executor,
  sandboxId: string,
  input: AlertInput,
  atSim: Date,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.sandboxId, sandboxId), eq(alerts.dedupeKey, input.dedupeKey), inArray(alerts.status, ["open", "acknowledged"])));
  if (existing) return { id: existing.id, created: false };
  const id = randomUUID();
  await db.insert(alerts).values({
    sandboxId,
    id,
    kind: input.kind,
    severity: input.severity,
    dedupeKey: input.dedupeKey,
    title: input.title,
    body: input.body,
    bodySource: "template",
    actions: input.actions,
    facts: input.facts,
    vehicleId: input.vehicleId ?? null,
    orderId: input.orderId ?? null,
    driverId: input.driverId ?? null,
    incidentId: input.incidentId ?? null,
    messageId: input.messageId ?? null,
    status: "open",
    createdSim: atSim,
  });
  return { id, created: true };
}

/** Resolves open alerts whose dedupe key starts with `prefix`, except `keepKey`. */
export async function resolveAlerts(db: Executor, sandboxId: string, prefix: string, atSim: Date, keepKey?: string) {
  const open = await db
    .select({ id: alerts.id, dedupeKey: alerts.dedupeKey })
    .from(alerts)
    .where(and(eq(alerts.sandboxId, sandboxId), like(alerts.dedupeKey, `${prefix}%`), inArray(alerts.status, ["open", "acknowledged"])));
  const ids = open.filter((a) => a.dedupeKey !== keepKey).map((a) => a.id);
  if (ids.length === 0) return 0;
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedSim: atSim })
    .where(and(eq(alerts.sandboxId, sandboxId), inArray(alerts.id, ids)));
  return ids.length;
}

export async function listAlerts(db: Executor, sandboxId: string, opts: { includeResolved?: boolean; limit?: number } = {}) {
  const where = opts.includeResolved
    ? eq(alerts.sandboxId, sandboxId)
    : and(eq(alerts.sandboxId, sandboxId), inArray(alerts.status, ["open", "acknowledged"]));
  return db
    .select()
    .from(alerts)
    .where(where)
    .orderBy(asc(alerts.status), desc(alerts.createdSim))
    .limit(opts.limit ?? 100);
}

export async function setAlertStatus(db: Executor, sandboxId: string, id: string, status: "acknowledged" | "resolved", atSim: Date) {
  const [row] = await db
    .update(alerts)
    .set({ status, resolvedSim: status === "resolved" ? atSim : null })
    .where(and(eq(alerts.sandboxId, sandboxId), eq(alerts.id, id)))
    .returning();
  return row;
}
