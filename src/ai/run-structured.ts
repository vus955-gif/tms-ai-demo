import { randomUUID } from "node:crypto";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ZodType } from "zod";
import { aiLog } from "@/db/schema";
import type { Executor } from "@/db/types";
import { budgetBlock, recordSpend } from "./budget";
import { getAiClient, type AiClient } from "./client";
import { AI_MODEL, costUsd } from "./pricing";

export type AiFunctionName =
  | "classifyDriverMessage"
  | "readCmr"
  | "explainAlert"
  | "draftMessage"
  | "triageClientEmail"
  | "extractQuoteRequest"
  | "readAgentQuote"
  | "diagnostics";

export type AiFallbackReason = "no_api_key" | "sandbox_limit" | "daily_budget" | "ai_error" | "refusal" | "catch_up";

export type AiOutcome<T> = {
  value: T;
  source: "ai" | "fallback";
  reason?: AiFallbackReason;
  logId: string;
};

export type RunStructuredOptions<T> = {
  fn: AiFunctionName;
  schema: ZodType<T>;
  system: string;
  content: ContentBlockParam[];
  fallback: () => T;
  db: Executor;
  sandboxId: string;
  simNow: Date;
  realNow?: Date;
  effort?: "low" | "medium";
  maxTokens?: number;
  model?: string;
  /** Short reference to what was analysed (message id, order number…) for the AI log. */
  inputRef?: string;
  /** Override the shared client (tests, or null to force fallback). */
  client?: AiClient | null;
  /** Reason to log when the fallback is forced via `client: null` (default: no_api_key). */
  fallbackReason?: AiFallbackReason;
};

export const AI_TIMEOUT_MS = 10_000;
const ATTEMPTS = 2;

/**
 * The single entry point for every AI call: budget checks, one retry, a
 * schema-validated answer or a rule-based fallback, and an AI log entry either way.
 */
export async function runStructured<T>(opts: RunStructuredOptions<T>): Promise<AiOutcome<T>> {
  const realNow = opts.realNow ?? new Date();
  const model = opts.model ?? AI_MODEL;
  const client = opts.client === undefined ? getAiClient() : opts.client;
  const logId = randomUUID();

  const log = async (entry: {
    output: unknown;
    fallback: boolean;
    reason?: AiFallbackReason;
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
  }) => {
    const inputTokens = entry.inputTokens ?? 0;
    const outputTokens = entry.outputTokens ?? 0;
    await opts.db.insert(aiLog).values({
      sandboxId: opts.sandboxId,
      id: logId,
      fn: opts.fn,
      model,
      inputRef: opts.inputRef ?? "",
      output: entry.output as object,
      inputTokens,
      outputTokens,
      costUsd: costUsd(model, inputTokens, outputTokens),
      latencyMs: entry.latencyMs ?? 0,
      fallbackUsed: entry.fallback,
      reason: entry.reason ?? null,
      error: entry.error ?? null,
      atSim: opts.simNow,
      createdReal: realNow,
    });
  };

  const fallBack = async (reason: AiFallbackReason, extra: Parameters<typeof log>[0] | null = null) => {
    const value = opts.fallback();
    await log({ ...(extra ?? {}), output: value, fallback: true, reason });
    return { value, source: "fallback" as const, reason, logId };
  };

  if (!client) return fallBack(opts.fallbackReason ?? "no_api_key");
  const blocked = await budgetBlock(opts.db, opts.sandboxId, realNow);
  if (blocked) return fallBack(blocked);

  let inputTokens = 0;
  let outputTokens = 0;
  let lastError = "";
  let lastReason: AiFallbackReason = "ai_error";
  const started = Date.now();

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await client.parse({
        model,
        system: opts.system,
        content: opts.content,
        schema: opts.schema,
        effort: opts.effort ?? "low",
        maxTokens: opts.maxTokens ?? 2048,
        timeoutMs: AI_TIMEOUT_MS,
      });
      inputTokens += response.inputTokens;
      outputTokens += response.outputTokens;
      await recordSpend(opts.db, opts.sandboxId, realNow, costUsd(model, response.inputTokens, response.outputTokens));
      if (response.stopReason === "refusal") {
        lastReason = "refusal";
        lastError = "Model declined the request (stop_reason: refusal)";
        continue;
      }
      if (response.parsed === null) {
        lastReason = "ai_error";
        lastError = `No parsable output (stop_reason: ${response.stopReason ?? "unknown"})`;
        continue;
      }
      await log({ output: response.parsed, fallback: false, inputTokens, outputTokens, latencyMs: Date.now() - started });
      return { value: response.parsed, source: "ai", logId };
    } catch (error) {
      lastReason = "ai_error";
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }

  return fallBack(lastReason, {
    output: null,
    fallback: true,
    error: lastError,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
  });
}
