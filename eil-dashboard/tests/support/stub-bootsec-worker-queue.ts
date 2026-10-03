/*
 * src/lib/worker-queue-start.ts for upload route tests: the analysis worker is
 * never called. Each start asked for is recorded in
 * globalThis.__bootsecWorkerStarts and answered as not started. Everything
 * else is the real module.
 */
import type { WorkerQueueStartResult } from "../../src/lib/worker-queue-start";

export * from "../../src/lib/worker-queue-start";

declare global {
  // eslint-disable-next-line no-var
  var __bootsecWorkerStarts: Array<{ maxRuns?: number; taskCount?: number; reason?: string }> | undefined;
}

export async function triggerWorkerQueueWithRetries(options?: { maxRuns?: number; taskCount?: number; reason?: string }): Promise<WorkerQueueStartResult> {
  (globalThis.__bootsecWorkerStarts ??= []).push(options ?? {});
  return {
    started: false,
    alreadyRunning: false,
    attempts: 1,
    trigger: { started: false, status: 0, payload: { reason: "test" } },
    progressStage: "queued_but_unstarted",
    progressMessage: "Upload succeeded, but processing did not start",
    progressDetail: "The worker is not called in tests.",
  };
}
