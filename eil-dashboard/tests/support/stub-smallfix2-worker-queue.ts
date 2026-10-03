/*
 * src/lib/worker-queue-start.ts for upload route tests: the analysis worker is
 * never called. A start fails as an unreachable worker does when
 * globalThis.__smallfix2WorkerDown is set, and is otherwise answered as
 * already running. Everything else is the real module.
 */
import type { WorkerQueueStartResult } from "../../src/lib/worker-queue-start";

export * from "../../src/lib/worker-queue-start";

declare global {
  // eslint-disable-next-line no-var
  var __smallfix2WorkerDown: string | undefined;
}

export async function triggerWorkerQueueWithRetries(): Promise<WorkerQueueStartResult> {
  if (globalThis.__smallfix2WorkerDown) throw new Error(globalThis.__smallfix2WorkerDown);
  return {
    started: false,
    alreadyRunning: true,
    attempts: 1,
    trigger: { started: false, status: 409, payload: { reason: "already_running" } },
    progressStage: "queued",
    progressMessage: "Queued",
    progressDetail: "Waiting for the worker.",
  };
}
