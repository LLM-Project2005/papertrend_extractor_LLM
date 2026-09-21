import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call model latency for one request.
 *
 * A focused answer makes several model calls in sequence and takes 17-30
 * seconds, but nothing recorded how long each call took. Every per-step number
 * had to be inferred from the gaps between progress frames, which cannot
 * separate a slow call from a silent retry. Recording the calls makes the next
 * round of tuning evidence-led rather than guesswork.
 */
export interface ModelCallTiming {
  task: string;
  ms: number;
  outcome: "ok" | "failed";
  /** The model that served the call, so per-task routing can be verified. */
  model?: string;
}

const storage = new AsyncLocalStorage<ModelCallTiming[]>();

export function runWithModelLatency<T>(fn: () => Promise<T>): Promise<{ value: T; timings: ModelCallTiming[] }> {
  const timings: ModelCallTiming[] = [];
  return storage.run(timings, async () => ({ value: await fn(), timings }));
}

export function recordModelCallLatency(
  task: string | undefined,
  ms: number,
  outcome: "ok" | "failed",
  model?: string
): void {
  const timings = storage.getStore();
  if (!timings) return;
  timings.push({ task: task ?? "unnamed", ms: Math.round(ms), outcome, model });
}

/** Totals by task, slowest first, for logging alongside the request. */
export function summarizeModelLatency(timings: ModelCallTiming[]): {
  totalMs: number;
  callCount: number;
  byTask: Array<{ task: string; calls: number; totalMs: number; models: string[] }>;
} {
  const byTask = new Map<string, { task: string; calls: number; totalMs: number; models: string[] }>();
  for (const timing of timings) {
    const row = byTask.get(timing.task) ?? { task: timing.task, calls: 0, totalMs: 0, models: [] };
    row.calls += 1;
    row.totalMs += timing.ms;
    if (timing.model && !row.models.includes(timing.model)) {
      row.models.push(timing.model);
    }
    byTask.set(timing.task, row);
  }
  return {
    totalMs: timings.reduce((sum, timing) => sum + timing.ms, 0),
    callCount: timings.length,
    byTask: [...byTask.values()].sort((left, right) => right.totalMs - left.totalMs),
  };
}
