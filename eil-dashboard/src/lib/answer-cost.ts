/**
 * What one answer cost, in tokens and in money.
 *
 * Token counts were already recorded, but a count is not a cost: the same
 * 20,000 tokens is a fraction of a cent on a fast model and several cents on a
 * reader-facing one, and this pipeline deliberately uses both. Without the
 * money figure the only way to learn what the product spends is to watch the
 * provider balance fall, which is how this project discovered it was nearly out
 * of credit.
 *
 * Prices are per million tokens, in US dollars, as OpenRouter lists them. They
 * change, so they are labelled with the date they were taken and a wrong price
 * produces a wrong estimate rather than a wrong answer.
 */

/** Prices taken from OpenRouter on 2026-09-22, per million tokens, USD. */
const PRICES: Record<string, { prompt: number; completion: number }> = {
  "openai/gpt-5.6-luna-20260709": { prompt: 2.5, completion: 10 },
  "google/gemini-3.7-flash": { prompt: 0.075, completion: 0.3 },
  "openai/gpt-4o": { prompt: 2.5, completion: 10 },
  "openai/text-embedding-3-small": { prompt: 0.02, completion: 0 },
};

/**
 * Used when a model is not in the table above.
 *
 * Deliberately the price of the expensive model rather than an average: an
 * unknown model showing a cost that is too high prompts someone to look, and
 * one showing a cost that is too low does not.
 */
const UNKNOWN_MODEL_PRICE = { prompt: 2.5, completion: 10 };

export interface ModelSpend {
  model: string;
  promptTokens: number;
  completionTokens: number;
  usd: number;
}

export function priceFor(model: string): { prompt: number; completion: number } {
  return PRICES[model] ?? UNKNOWN_MODEL_PRICE;
}

export function isPricedModel(model: string): boolean {
  return model in PRICES;
}

/** Cost of one model call, in US dollars. */
export function costOfCall(model: string, promptTokens: number, completionTokens: number): number {
  const price = priceFor(model);
  const usd = (promptTokens / 1_000_000) * price.prompt + (completionTokens / 1_000_000) * price.completion;
  // Six places: a cheap call can genuinely cost less than a hundredth of a cent,
  // and rounding those to zero would make the running total drift low.
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Cost of a whole answer, broken down by the models that served it. */
export function summarizeSpend(
  calls: Array<{ model: string; promptTokens: number; completionTokens: number }>
): { usd: number; byModel: ModelSpend[]; unpricedModels: string[] } {
  const byModel = new Map<string, ModelSpend>();
  const unpriced = new Set<string>();

  for (const call of calls) {
    if (!isPricedModel(call.model)) unpriced.add(call.model);
    const row = byModel.get(call.model) ?? {
      model: call.model,
      promptTokens: 0,
      completionTokens: 0,
      usd: 0,
    };
    row.promptTokens += call.promptTokens;
    row.completionTokens += call.completionTokens;
    row.usd = costOfCall(row.model, row.promptTokens, row.completionTokens);
    byModel.set(call.model, row);
  }

  const rows = [...byModel.values()].sort((left, right) => right.usd - left.usd);
  return {
    usd: Math.round(rows.reduce((sum, row) => sum + row.usd, 0) * 1_000_000) / 1_000_000,
    byModel: rows,
    unpricedModels: [...unpriced],
  };
}

/** A cost a reader or an owner can read, rather than a float in scientific notation. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
