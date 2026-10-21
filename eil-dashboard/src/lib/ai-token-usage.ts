import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelTokens } from "@/lib/model-prices";

export interface AiTokenUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  /**
   * Per model, so a total can be turned into money.
   *
   * A token count is not a cost: the same 20,000 tokens is a fraction of a cent
   * on the fast model and several cents on the reader-facing one, and this
   * pipeline uses both in the same answer.
   */
  byModel: ModelTokens[];
  /**
   * What the provider says it charged, in US dollars, summed over the calls
   * that reported it. OpenRouter reports `usage.cost` on every call, and it
   * includes what tokens alone cannot show: a web search's fee.
   */
  reportedUsd?: number;
  /** Calls that reported a cost, so a partial sum is not read as the whole. */
  reportedCalls?: number;
}

const usageStore = new AsyncLocalStorage<AiTokenUsageTotals>();

function finiteTokenCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function recordAiTokenUsage(usage: unknown, model?: string): void {
  const totals = usageStore.getStore();
  if (!totals || !usage || typeof usage !== "object") return;
  const value = usage as Record<string, unknown>;
  const promptTokens = finiteTokenCount(value.prompt_tokens ?? value.input_tokens);
  const completionTokens = finiteTokenCount(value.completion_tokens ?? value.output_tokens);
  const reportedTotal = finiteTokenCount(value.total_tokens);
  // Which prompt tokens came from the provider's cache, and which were written
  // to it: GPT-6.1 Sol's cached input counts ten Luna tokens, the rest twenty.
  const details = (value.prompt_tokens_details ?? value.input_tokens_details) as Record<string, unknown> | undefined;
  const cachedTokens = Math.min(promptTokens, finiteTokenCount(details?.cached_tokens));
  const cacheWriteTokens = Math.min(promptTokens - cachedTokens, finiteTokenCount(details?.cache_write_tokens));
  totals.promptTokens += promptTokens;
  totals.completionTokens += completionTokens;
  totals.totalTokens += reportedTotal || promptTokens + completionTokens;
  totals.calls += 1;
  const cost = Number(value.cost);
  if (Number.isFinite(cost) && cost >= 0) {
    totals.reportedUsd = (totals.reportedUsd ?? 0) + cost;
    totals.reportedCalls = (totals.reportedCalls ?? 0) + 1;
  }

  const name = model?.trim() || "unknown";
  const row = totals.byModel.find((entry) => entry.model === name);
  const target = row ?? { model: name, promptTokens: 0, completionTokens: 0 };
  if (!row) totals.byModel.push(target);
  target.promptTokens += promptTokens;
  target.completionTokens += completionTokens;
  // Kept only where the provider reported them, so a row says nothing it was not told.
  if (cachedTokens > 0) target.cachedTokens = (target.cachedTokens ?? 0) + cachedTokens;
  if (cacheWriteTokens > 0) target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + cacheWriteTokens;
}

export function withAiTokenUsageTracking<T>(
  callback: (totals: AiTokenUsageTotals) => Promise<T>
): Promise<T> {
  const totals: AiTokenUsageTotals = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
    byModel: [],
    reportedUsd: 0,
    reportedCalls: 0,
  };
  return usageStore.run(totals, () => callback(totals));
}
