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
 * Prices are per million tokens, in US dollars, as OpenRouter lists them, in
 * one table (model-prices.ts) that the daily allowance reads too.
 */
import { isPricedModel, priceOf } from "@/lib/model-prices";

/**
 * One web search through OpenRouter's web plugin on the Exa engine, which
 * includes up to ten results. Tokens do not show it, so it is added per search
 * when the provider's own figure is missing.
 */
export const WEB_SEARCH_FEE_USD = 0.007;

/**
 * The provider's figure when every call reported one; otherwise the estimate
 * from tokens, plus any search fees the tokens cannot show.
 */
export function spendUsd(
  usage: { calls: number; byModel: Array<{ model: string; promptTokens: number; completionTokens: number }>; reportedUsd?: number; reportedCalls?: number },
  webSearches = 0
): { usd: number; source: "provider" | "estimate" } {
  if (usage.calls > 0 && usage.reportedCalls === usage.calls && typeof usage.reportedUsd === "number") {
    return { usd: Math.round(usage.reportedUsd * 1_000_000) / 1_000_000, source: "provider" };
  }
  const estimate = summarizeSpend(usage.byModel).usd + webSearches * WEB_SEARCH_FEE_USD;
  return { usd: Math.round(estimate * 1_000_000) / 1_000_000, source: "estimate" };
}

export interface ModelSpend {
  model: string;
  promptTokens: number;
  completionTokens: number;
  usd: number;
}

/** A model's input and output price per million tokens (model-prices.ts holds the table). */
export function priceFor(model: string): { prompt: number; completion: number } {
  const price = priceOf(model);
  return { prompt: price.input, completion: price.output };
}

export { isPricedModel };

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
