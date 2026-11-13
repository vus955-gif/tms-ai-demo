export const AI_MODEL = "claude-haiku-5-5";
/** Used only for CMR reading if Haiku turns out not to accept images (spec decision 13). */
export const AI_FALLBACK_VISION_MODEL = "claude-sonnet-5-5";

type Price = { input: number; output: number; longInput?: number; longOutput?: number; longFrom?: number };

/** USD per million tokens (Anthropic API price list, 2026-10-06). */
const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5, longFrom: 100_000 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** Only a model with a known price may be called: for any other the spend would count as 0 and skip the budget. */
export function hasPrice(model: string): boolean {
  return Object.hasOwn(PRICES, model);
}

/** Cost of one call; 0 for a model without a price (`runStructured` never calls such a model). */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  if (!hasPrice(model)) return 0;
  const price = PRICES[model];
  const long = price.longFrom !== undefined && inputTokens > price.longFrom;
  const inRate = long ? price.longInput! : price.input;
  const outRate = long ? price.longOutput! : price.output;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}
