export const AI_MODEL = "claude-haiku-5-5";
/** Used only for CMR reading if Haiku turns out not to accept images (spec decision 13). */
export const AI_FALLBACK_VISION_MODEL = "claude-sonnet-5-5";

type Price = { input: number; output: number; longInput?: number; longOutput?: number; longFrom?: number };

/** USD per million tokens (Anthropic API price list, 2026-10-06). */
const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5, longFrom: 100_000 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  const long = price.longFrom !== undefined && inputTokens > price.longFrom;
  const inRate = long ? price.longInput! : price.input;
  const outRate = long ? price.longOutput! : price.output;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}
