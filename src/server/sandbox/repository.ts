import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gte, lt } from "drizzle-orm";
import { sandboxes } from "@/db/schema";
import type { Db } from "@/db/types";
import { simOriginFor } from "@/simulation/clock";
import { config } from "../config";
import { isValidSandboxId } from "./cookie";
import { seedScenario } from "./seed";

export type SandboxRow = typeof sandboxes.$inferSelect;

const HOUR = 3_600_000;

/** Hook for later stages: extra seeding (plans, scheduled events) after the scenario copy. */
type SeedExtension = (db: Parameters<typeof seedScenario>[0], sandbox: SandboxRow) => Promise<void>;
const seedExtensions: SeedExtension[] = [];
export function registerSeedExtension(extension: SeedExtension) {
  seedExtensions.push(extension);
}

function freshClock(realNow: Date) {
  const simOrigin = simOriginFor(realNow);
  return {
    simOrigin,
    simElapsedMs: 0,
    running: true,
    speed: config.defaultSpeed,
    realResumedAt: realNow,
    lastTickSim: simOrigin,
    version: 0,
    aiWindowStart: null,
    aiCallsInWindow: 0,
  };
}

function expiry(realNow: Date) {
  return new Date(realNow.getTime() + config.sandboxTtlHours * HOUR);
}

export async function createSandbox(
  db: Db,
  opts: { ipHash: string; realNow: Date; id?: string; randomRun?: boolean },
): Promise<SandboxRow> {
  const id = opts.id ?? randomUUID();
  const randomRun = opts.randomRun ?? false;
  const row = {
    id,
    createdAt: opts.realNow,
    lastSeenAt: opts.realNow,
    expiresAt: expiry(opts.realNow),
    seed: randomRun ? Math.floor(Math.random() * 2 ** 31) : config.defaultSeed,
    randomRun,
    ipHash: opts.ipHash,
    ...freshClock(opts.realNow),
  };
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(sandboxes).values(row).returning();
    await seedScenario(tx, id, row.simOrigin);
    for (const extension of seedExtensions) await extension(tx, created);
    return created;
  });
}

export async function getSandbox(db: Db, id: string): Promise<SandboxRow | undefined> {
  const [row] = await db.select().from(sandboxes).where(eq(sandboxes.id, id));
  return row;
}

/** Deletes the world's data and seeds it again under the same id. */
export async function resetSandbox(
  db: Db,
  id: string,
  realNow: Date,
  opts: { randomRun?: boolean } = {},
): Promise<SandboxRow> {
  const existing = await getSandbox(db, id);
  if (!existing) throw new Error(`Sandbox ${id} not found`);
  await db.delete(sandboxes).where(eq(sandboxes.id, id));
  return createSandbox(db, {
    id,
    ipHash: existing.ipHash,
    realNow,
    randomRun: opts.randomRun ?? existing.randomRun,
  });
}

export async function getOrCreateSandbox(
  db: Db,
  opts: { cookieValue: string | undefined; ipHash: string; realNow: Date },
): Promise<{ sandbox: SandboxRow; created: boolean }> {
  const { cookieValue, ipHash, realNow } = opts;
  if (isValidSandboxId(cookieValue)) {
    const existing = await getSandbox(db, cookieValue);
    if (existing && existing.expiresAt > realNow) {
      const [touched] = await db
        .update(sandboxes)
        .set({ lastSeenAt: realNow, expiresAt: expiry(realNow) })
        .where(eq(sandboxes.id, existing.id))
        .returning();
      return { sandbox: touched, created: false };
    }
  }

  const since = new Date(realNow.getTime() - 24 * HOUR);
  const [{ value: recent }] = await db
    .select({ value: count() })
    .from(sandboxes)
    .where(and(eq(sandboxes.ipHash, ipHash), gte(sandboxes.createdAt, since)));
  if (recent >= config.newSandboxesPerIpPerDay) {
    const [oldest] = await db
      .select()
      .from(sandboxes)
      .where(eq(sandboxes.ipHash, ipHash))
      .orderBy(asc(sandboxes.createdAt))
      .limit(1);
    if (oldest) return { sandbox: await resetSandbox(db, oldest.id, realNow), created: true };
  }
  return { sandbox: await createSandbox(db, { ipHash, realNow }), created: true };
}

export async function cleanupExpired(db: Db, realNow: Date, limit = 5): Promise<number> {
  const expired = await db
    .select({ id: sandboxes.id })
    .from(sandboxes)
    .where(lt(sandboxes.expiresAt, realNow))
    .limit(limit);
  for (const { id } of expired) await db.delete(sandboxes).where(eq(sandboxes.id, id));
  return expired.length;
}
