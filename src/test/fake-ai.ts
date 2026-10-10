import type { AiClient, ModelCapabilities, ParseRequest, ParseResponse } from "@/ai/client";

type Step = ParseResponse<unknown> | Error | ((request: ParseRequest<unknown>) => ParseResponse<unknown>);

/** A scripted AI client: each parse() call consumes the next step. */
export function fakeAiClient(
  steps: Step[],
  capabilities: ModelCapabilities = { imageInput: true, structuredOutputs: true },
): AiClient & { calls: ParseRequest<unknown>[] } {
  const calls: ParseRequest<unknown>[] = [];
  return {
    calls,
    async parse<T>(request: ParseRequest<T>): Promise<ParseResponse<T>> {
      calls.push(request as ParseRequest<unknown>);
      const step = steps.shift();
      if (!step) throw new Error("fakeAiClient: no scripted response left");
      if (step instanceof Error) throw step;
      const response = typeof step === "function" ? step(request as ParseRequest<unknown>) : step;
      return response as ParseResponse<T>;
    },
    async capabilities() {
      return capabilities;
    },
  };
}

export const ok = <T>(parsed: T, inputTokens = 1000, outputTokens = 100): ParseResponse<T> => ({
  parsed,
  stopReason: "end_turn",
  inputTokens,
  outputTokens,
});
