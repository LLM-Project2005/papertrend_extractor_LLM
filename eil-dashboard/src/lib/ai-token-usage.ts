import { AsyncLocalStorage } from "node:async_hooks";

export interface AiTokenUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

const usageStore = new AsyncLocalStorage<AiTokenUsageTotals>();

function finiteTokenCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function recordAiTokenUsage(usage: unknown): void {
  const totals = usageStore.getStore();
  if (!totals || !usage || typeof usage !== "object") return;
  const value = usage as Record<string, unknown>;
  const promptTokens = finiteTokenCount(value.prompt_tokens ?? value.input_tokens);
  const completionTokens = finiteTokenCount(value.completion_tokens ?? value.output_tokens);
  const reportedTotal = finiteTokenCount(value.total_tokens);
  totals.promptTokens += promptTokens;
  totals.completionTokens += completionTokens;
  totals.totalTokens += reportedTotal || promptTokens + completionTokens;
  totals.calls += 1;
}

export function withAiTokenUsageTracking<T>(
  callback: (totals: AiTokenUsageTotals) => Promise<T>
): Promise<T> {
  const totals: AiTokenUsageTotals = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
  };
  return usageStore.run(totals, () => callback(totals));
}
