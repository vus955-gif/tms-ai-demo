import { z } from "zod";
import type { Executor } from "@/db/types";
import { budgetBlock } from "./budget";
import { getAiClient, hasApiCredentials, type AiClient, type ModelCapabilities } from "./client";
import { AI_MODEL } from "./pricing";
import { runStructured, type AiFallbackReason } from "./run-structured";

export type AiStatus = { mode: "live" | "fallback"; reason?: AiFallbackReason };

export async function aiStatus(db: Executor, sandboxId: string, realNow: Date): Promise<AiStatus> {
  if (!hasApiCredentials()) return { mode: "fallback", reason: "no_api_key" };
  const blocked = await budgetBlock(db, sandboxId, realNow);
  return blocked ? { mode: "fallback", reason: blocked } : { mode: "live" };
}

export type Diagnostics = {
  model: string;
  hasKey: boolean;
  capabilities: ModelCapabilities | null;
  capabilitiesError?: string;
  sample: { source: "ai" | "fallback"; reason?: AiFallbackReason; category: string };
};

const SampleSchema = z.object({ category: z.enum(["potwierdzenie", "odmowa", "inne"]) });

/** Checks the key, the model's capabilities (image input!) and one tiny structured call. */
export async function runDiagnostics(
  db: Executor,
  sandboxId: string,
  simNow: Date,
  client: AiClient | null = getAiClient(),
): Promise<Diagnostics> {
  let capabilities: ModelCapabilities | null = null;
  let capabilitiesError: string | undefined;
  if (client) {
    try {
      capabilities = await client.capabilities(AI_MODEL);
    } catch (error) {
      capabilitiesError = error instanceof Error ? error.message : String(error);
    }
  }
  const sample = await runStructured({
    fn: "diagnostics",
    schema: SampleSchema,
    system: "Klasyfikujesz krótkie odpowiedzi kierowców na zlecenie transportowe.",
    content: [{ type: "text", text: "Odpowiedź kierowcy: <wiadomosc>ok, jadę</wiadomosc>" }],
    fallback: () => ({ category: "potwierdzenie" as const }),
    db,
    sandboxId,
    simNow,
    inputRef: "test: „ok, jadę”",
    client,
  });
  return {
    model: AI_MODEL,
    hasKey: client !== null,
    capabilities,
    capabilitiesError,
    sample: { source: sample.source, reason: sample.reason, category: sample.value.category },
  };
}
