import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ZodType } from "zod";

export type ParseRequest<T> = {
  model: string;
  system: string;
  content: ContentBlockParam[];
  schema: ZodType<T>;
  effort: "low" | "medium";
  maxTokens: number;
  timeoutMs: number;
};

export type ParseResponse<T> = {
  parsed: T | null;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type ModelCapabilities = { imageInput: boolean; structuredOutputs: boolean };

/** The slice of the Anthropic SDK this app uses; tests substitute a fake. */
export interface AiClient {
  parse<T>(request: ParseRequest<T>): Promise<ParseResponse<T>>;
  capabilities(model: string): Promise<ModelCapabilities>;
}

export function hasApiCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

type CapabilityTree = Record<string, { supported?: boolean } | undefined>;

export function createAnthropicClient(): AiClient {
  // maxRetries: 0 — retries are handled once, explicitly, by runStructured.
  const sdk = new Anthropic({ maxRetries: 0 });
  return {
    async parse<T>(request: ParseRequest<T>): Promise<ParseResponse<T>> {
      const response = await sdk.messages.parse(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.content }],
          output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
        },
        { timeout: request.timeoutMs },
      );
      return {
        parsed: (response.parsed_output ?? null) as T | null,
        stopReason: response.stop_reason ?? null,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
    async capabilities(model: string): Promise<ModelCapabilities> {
      const info = await sdk.models.retrieve(model);
      const caps = (info.capabilities ?? {}) as unknown as CapabilityTree;
      return {
        imageInput: Boolean(caps.image_input?.supported),
        structuredOutputs: Boolean(caps.structured_outputs?.supported),
      };
    },
  };
}

let shared: AiClient | null | undefined;

/** The real client when credentials exist, otherwise null (fallback mode). */
export function getAiClient(): AiClient | null {
  if (shared === undefined) shared = hasApiCredentials() ? createAnthropicClient() : null;
  return shared;
}

/** Test hook. */
export function setAiClientForTests(client: AiClient | null | undefined) {
  shared = client;
}
