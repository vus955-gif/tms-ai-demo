import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { sandboxes, vehicles } from "./schema";

const EXPECTED_TABLES = [
  "ai_budget_daily",
  "ai_log",
  "client_contacts",
  "clients",
  "couplings",
  "driver_activities",
  "driver_client_history",
  "drivers",
  "order_status_changes",
  "orders",
  "points",
  "sandboxes",
  "scheduled_events",
  "trailers",
  "vehicles",
];

describe("database schema", () => {
  it("creates every stage-0 table", async () => {
    const db = await createTestDb();
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = result.rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TABLES));
  });

  it("deletes a world's rows together with the world", async () => {
    const db = await createTestDb();
    const now = new Date("2026-10-12T06:30:00Z");
    await db.insert(sandboxes).values({
      id: "sb-1",
      lastSeenAt: now,
      expiresAt: now,
      seed: 1,
      simOrigin: now,
      realResumedAt: now,
      lastTickSim: now,
      ipHash: "x",
    });
    await db.insert(vehicles).values({
      sandboxId: "sb-1",
      id: "v-1",
      kind: "bus",
      plates: "PO 1AA",
      subjectTo561: false,
      odometerKm: 1000,
      homePointId: "pt-1",
    });
    await db.delete(sandboxes).where(eq(sandboxes.id, "sb-1"));
    const left = await db.select().from(vehicles);
    expect(left).toHaveLength(0);
  });
});
