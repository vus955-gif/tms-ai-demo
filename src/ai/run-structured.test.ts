import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { aiBudgetDaily, aiLog, sandboxes } from "@/db/schema";
import type { Db } from "@/db/types";
import { createSandbox, getOrCreateSandbox, resetSandbox, type SandboxRow } from "@/server/sandbox/repository";
import { createTestDb } from "@/test/db";
import { fakeAiClient, ok } from "@/test/fake-ai";
import { costUsd } from "./pricing";
import { runStructured } from "./run-structured";
import { aiStatus, runDiagnostics } from "./status";

const Schema = z.object({ category: z.enum(["tak", "nie"]) });
const realNow = new Date("2026-10-14T10:00:00Z");

describe("runStructured", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const base = () => ({
    fn: "classifyDriverMessage" as const,
    schema: Schema,
    system: "test",
    content: [{ type: "text" as const, text: "ok" }],
    fallback: () => ({ category: "nie" as const }),
    db,
    sandboxId: sandbox.id,
    simNow: sandbox.simOrigin,
    realNow,
  });
  const logs = () => db.select().from(aiLog).where(eq(aiLog.sandboxId, sandbox.id));

  beforeEach(async () => {
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "ip", realNow });
  });
  afterEach(() => {
    delete process.env.AI_DAILY_BUDGET_USD;
    delete process.env.AI_CALLS_PER_IP_PER_HOUR;
    delete process.env.SANDBOXES_PER_IP_PER_DAY;
  });

  it("falls back without a client and says why", async () => {
    const result = await runStructured({ ...base(), client: null });
    expect(result).toMatchObject({ source: "fallback", reason: "no_api_key", value: { category: "nie" } });
    const [entry] = await logs();
    expect(entry).toMatchObject({ fallbackUsed: true, reason: "no_api_key", costUsd: 0 });
  });

  it("returns the parsed answer, logs tokens and cost, and counts the spend", async () => {
    const client = fakeAiClient([ok({ category: "tak" }, 2000, 200)]);
    const result = await runStructured({ ...base(), client });
    expect(result).toMatchObject({ source: "ai", value: { category: "tak" } });
    expect(client.calls[0]).toMatchObject({ model: "claude-haiku-5-5", effort: "low", timeoutMs: 10_000 });
    const [entry] = await logs();
    expect(entry).toMatchObject({ fallbackUsed: false, inputTokens: 2000, outputTokens: 200 });
    expect(entry.costUsd).toBeCloseTo(costUsd("claude-haiku-5-5", 2000, 200), 10);
    const [daily] = await db.select().from(aiBudgetDaily);
    expect(daily.calls).toBe(1);
    const [row] = await db.select().from(sandboxes).where(eq(sandboxes.id, sandbox.id));
    expect(row.aiCallsInWindow).toBe(1);
  });

  it("retries once when the output does not parse, then succeeds", async () => {
    const client = fakeAiClient([{ parsed: null, stopReason: "max_tokens", inputTokens: 500, outputTokens: 50 }, ok({ category: "tak" })]);
    const result = await runStructured({ ...base(), client });
    expect(result.source).toBe("ai");
    expect(client.calls).toHaveLength(2);
    const [entry] = await logs();
    expect(entry.inputTokens).toBe(1500);
  });

  it("falls back after two failures and keeps the error", async () => {
    const client = fakeAiClient([new Error("network down"), new Error("network down")]);
    const result = await runStructured({ ...base(), client });
    expect(result).toMatchObject({ source: "fallback", reason: "ai_error" });
    const [entry] = await logs();
    expect(entry.error).toContain("network down");
  });

  it("treats a refusal like a failure", async () => {
    const refusal = { parsed: null, stopReason: "refusal", inputTokens: 10, outputTokens: 0 };
    const client = fakeAiClient([refusal, refusal]);
    const result = await runStructured({ ...base(), client });
    expect(result).toMatchObject({ source: "fallback", reason: "refusal" });
  });

  it("stops calling AI once the address used its hourly allowance", async () => {
    process.env.AI_CALLS_PER_IP_PER_HOUR = "1";
    const client = fakeAiClient([ok({ category: "tak" }), ok({ category: "tak" })]);
    await runStructured({ ...base(), client });
    const second = await runStructured({ ...base(), client });
    expect(second).toMatchObject({ source: "fallback", reason: "sandbox_limit" });
    expect(client.calls).toHaveLength(1);
    // A new hour opens a new window.
    const nextHour = new Date(realNow.getTime() + 61 * 60_000);
    const third = await runStructured({ ...base(), client, realNow: nextHour });
    expect(third.source).toBe("ai");
  });

  it("keeps counting when the visitor drops the cookie and gets a new world", async () => {
    process.env.AI_CALLS_PER_IP_PER_HOUR = "1";
    const client = fakeAiClient([ok({ category: "tak" }), ok({ category: "tak" })]);
    await runStructured({ ...base(), client });
    // No cookie: a brand-new world for the same address.
    const { sandbox: fresh } = await getOrCreateSandbox(db, { cookieValue: undefined, ipHash: "ip", realNow });
    expect(fresh.id).not.toBe(sandbox.id);
    const second = await runStructured({ ...base(), sandboxId: fresh.id, client });
    expect(second).toMatchObject({ source: "fallback", reason: "sandbox_limit" });
    // The limit belongs to the address: another one still gets its calls.
    const other = await createSandbox(db, { ipHash: "other-ip", realNow });
    expect((await runStructured({ ...base(), sandboxId: other.id, client })).source).toBe("ai");
    expect(client.calls).toHaveLength(2);
  });

  it("keeps counting when the address runs out of worlds and its oldest one is reset", async () => {
    process.env.AI_CALLS_PER_IP_PER_HOUR = "1";
    process.env.SANDBOXES_PER_IP_PER_DAY = "1";
    const client = fakeAiClient([ok({ category: "tak" }), ok({ category: "tak" })]);
    await runStructured({ ...base(), client });
    // No cookie and no new world allowed: the oldest world of the address starts over.
    const { sandbox: recycled } = await getOrCreateSandbox(db, { cookieValue: undefined, ipHash: "ip", realNow });
    expect(recycled.id).toBe(sandbox.id);
    expect(await runStructured({ ...base(), client })).toMatchObject({ source: "fallback", reason: "sandbox_limit" });
    // The same for the "start over" button.
    await resetSandbox(db, sandbox.id, realNow);
    expect(await runStructured({ ...base(), client })).toMatchObject({ source: "fallback", reason: "sandbox_limit" });
    expect(client.calls).toHaveLength(1);
  });

  it("lets through only what fits under the limit when requests come at once", async () => {
    process.env.AI_CALLS_PER_IP_PER_HOUR = "2";
    const client = fakeAiClient(Array.from({ length: 5 }, () => ok({ category: "tak" as const })));
    const results = await Promise.all(Array.from({ length: 5 }, () => runStructured({ ...base(), client })));
    expect(client.calls).toHaveLength(2);
    expect(results.filter((r) => r.source === "ai")).toHaveLength(2);
    expect(results.filter((r) => r.reason === "sandbox_limit")).toHaveLength(3);
    // Claims that did not fit were given back: the window counts the calls actually made.
    const [row] = await db.select().from(sandboxes).where(eq(sandboxes.id, sandbox.id));
    expect(row.aiCallsInWindow).toBe(2);
  });

  it("stops calling AI once the daily budget is spent", async () => {
    process.env.AI_DAILY_BUDGET_USD = "0.0001";
    const client = fakeAiClient([ok({ category: "tak" }, 5000, 500), ok({ category: "tak" })]);
    await runStructured({ ...base(), client });
    const second = await runStructured({ ...base(), client });
    expect(second).toMatchObject({ source: "fallback", reason: "daily_budget" });
    expect(await aiStatus(db, sandbox.id, realNow)).toEqual({ mode: "fallback", reason: "no_api_key" });
  });
});

describe("runDiagnostics", () => {
  it("reports capabilities and the sample answer", async () => {
    const db = await createTestDb();
    const sandbox = await createSandbox(db, { ipHash: "ip", realNow });
    const client = fakeAiClient([ok({ category: "potwierdzenie" })], { imageInput: true, structuredOutputs: true });
    const result = await runDiagnostics(db, sandbox.id, sandbox.simOrigin, client);
    expect(result).toMatchObject({
      model: "claude-haiku-5-5",
      hasKey: true,
      capabilities: { imageInput: true, structuredOutputs: true },
      sample: { source: "ai", category: "potwierdzenie" },
    });
  });

  it("says plainly that there is no key", async () => {
    const db = await createTestDb();
    const sandbox = await createSandbox(db, { ipHash: "ip", realNow });
    const result = await runDiagnostics(db, sandbox.id, sandbox.simOrigin, null);
    expect(result).toMatchObject({ hasKey: false, capabilities: null, sample: { source: "fallback", reason: "no_api_key" } });
  });
});
