/**
 * What each model costs, and how much of the daily allowance its tokens use.
 *
 * Prices are per million tokens, in US dollars, as OpenRouter lists them. They
 * change, so each is labelled with the date it was taken; a wrong price
 * produces a wrong estimate rather than a wrong answer.
 *
 * The daily allowance is counted in GPT-6 Luna tokens (the professor's rule,
 * 2026-10-22): a token from another model counts as many Luna tokens as it
 * costs, kind by kind. A GPT-6.1 Sol output token costs twenty times a Luna
 * one, so it counts as twenty; a Sol token read from the cache costs ten times
 * a cached Luna one, so it counts as ten. Luna itself counts one for one, as
 * before. A new model needs only its prices added here.
 */

export interface TokenPrice {
  input: number;
  output: number;
  /** Input read from the provider's prompt cache. Without it, cached input is priced as plain input. */
  cacheRead?: number;
  /** Input written to the cache (OpenRouter's explicit caching). Without it, priced as plain input. */
  cacheWrite?: number;
}

export interface ModelPrice extends TokenPrice {
  /** A dearer tier for very long prompts, from this many prompt tokens. */
  longContext?: TokenPrice & { fromPromptTokens: number };
}

export const LUNA_MODEL = "openai/gpt-6-luna-20260922";
export const SOL_MODEL = "openai/gpt-6.1-sol-20260929";

const LUNA_PRICE: ModelPrice = {
  input: 0.1,
  output: 0.5,
  cacheRead: 0.01,
  cacheWrite: 0.125,
  longContext: { fromPromptTokens: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 },
};

// GPT-6.1 Sol rather than GPT-6 Sol: the same input and output price, and its
// cached input costs half (OpenRouter, 2026-10-22).
const SOL_PRICE: ModelPrice = {
  input: 2,
  output: 10,
  cacheRead: 0.1,
  cacheWrite: 2.5,
  longContext: { fromPromptTokens: 272_000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 },
};

/**
 * Taken from OpenRouter's model list: GPT-6 Luna and GPT-6.1 Sol on
 * 2026-10-22, the rest on 2026-09-29. Both an exact (dated) name and its
 * undated alias are listed, since either can reach a call.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  [LUNA_MODEL]: LUNA_PRICE,
  "openai/gpt-6-luna": LUNA_PRICE,
  [SOL_MODEL]: SOL_PRICE,
  "openai/gpt-6.1-sol": SOL_PRICE,
  "google/gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "google/gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.0833 },
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.0833 },
  // Earlier models, for answers recorded before 2026-10-09.
  "openai/gpt-5.6-luna-20260709": { input: 0.2, output: 1.2 },
  "openai/gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "google/gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/text-embedding-3-small": { input: 0.02, output: 0 },
};

/**
 * Used when a model is not in the table. Deliberately the price of an
 * expensive model rather than an average: an unknown model that costs or
 * counts too much prompts someone to look, and one that counts too little does
 * not.
 */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { input: 2.5, output: 10 };

export function priceOf(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? UNKNOWN_MODEL_PRICE;
}

export function isPricedModel(model: string): boolean {
  return model in MODEL_PRICES;
}

/** One model's tokens in a request. The cache counts are part of the prompt tokens, when the provider gave them. */
export interface ModelTokens {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
}

/** How many GPT-6 Luna tokens one token of each kind counts as. */
export function usageWeights(model: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const price = priceOf(model);
  const input = price.input / LUNA_PRICE.input;
  return {
    input,
    output: price.output / LUNA_PRICE.output,
    // A model with no cache price is charged plain input for cached tokens, so they count as plain input.
    cacheRead: price.cacheRead !== undefined ? price.cacheRead / LUNA_PRICE.cacheRead! : input,
    cacheWrite: price.cacheWrite !== undefined ? price.cacheWrite / LUNA_PRICE.cacheWrite! : input,
  };
}

/**
 * The daily allowance a request used, in GPT-6 Luna tokens. When the provider
 * did not say which prompt tokens came from the cache, all of them count as
 * plain input, which for GPT-6.1 Sol is twenty, never less than it cost.
 */
export function allowanceUnits(rows: ReadonlyArray<ModelTokens>): number {
  let units = 0;
  for (const row of rows) {
    const weights = usageWeights(row.model);
    const cached = Math.max(0, row.cachedTokens ?? 0);
    const written = Math.max(0, row.cacheWriteTokens ?? 0);
    const plain = Math.max(0, row.promptTokens - cached - written);
    units +=
      plain * weights.input +
      Math.min(cached, row.promptTokens) * weights.cacheRead +
      Math.min(written, Math.max(0, row.promptTokens - cached)) * weights.cacheWrite +
      row.completionTokens * weights.output;
  }
  return Math.ceil(units);
}

/** About how many times GPT-6 Luna a model counts, for its label: GPT-6.1 Sol is 20. */
export function usageMultiplier(model: string): number {
  const weights = usageWeights(model);
  return Math.max(1, Math.round(Math.max(weights.input, weights.output)));
}
