import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerWorkerQueue } from "@/lib/worker-trigger";

export type WorkerQueueStartResult = {
  started: boolean;
  alreadyRunning: boolean;
  attempts: number;
  trigger: {
    started: boolean;
    status: number;
    payload: Record<string, unknown>;
  };
  progressStage: "queued" | "queued_waiting_for_worker" | "queued_but_unstarted";
  progressMessage: string;
  progressDetail: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkerQueueStartResult(args: {
  trigger: { started: boolean; status: number; payload: Record<string, unknown> };
  attempts: number;
}): WorkerQueueStartResult {
  const alreadyRunning = Boolean(args.trigger.payload?.already_running);
  if (args.trigger.started) {
    return {
      started: true,
      alreadyRunning: false,
      attempts: args.attempts,
      trigger: args.trigger,
      progressStage: "queued",
      progressMessage: "Queued",
      progressDetail:
        args.attempts > 1
          ? "The analysis worker was started after a retry and should begin claiming queued files shortly."
          : "The files were queued successfully and the analysis worker was asked to start immediately.",
    };
  }

  if (alreadyRunning) {
    return {
      started: false,
      alreadyRunning: true,
      attempts: args.attempts,
      trigger: args.trigger,
      progressStage: "queued_waiting_for_worker",
      progressMessage: "Waiting for active worker",
      progressDetail:
        "Another analysis batch is already running. Your files are queued and should start once that worker finishes or frees capacity.",
    };
  }

  const reason =
    typeof args.trigger.payload?.reason === "string"
      ? args.trigger.payload.reason
      : "unknown_reason";
  const suffix =
    reason === "missing_worker_config"
      ? "Worker service configuration is missing in the app runtime."
      : "The worker trigger did not report a successful queue start.";

  return {
    started: false,
    alreadyRunning: false,
    attempts: args.attempts,
    trigger: args.trigger,
    progressStage: "queued_but_unstarted",
    progressMessage: "Upload succeeded, but processing did not start",
    progressDetail: `${suffix} Use “Start processing now” to retry the worker start from the analysis status card.`,
  };
}

export async function triggerWorkerQueueWithRetries(options?: {
  maxRuns?: number;
  reason?: string;
  attempts?: number;
  retryDelayMs?: number;
  force?: boolean;
}): Promise<WorkerQueueStartResult> {
  const maxAttempts = Math.min(Math.max(options?.attempts ?? 3, 1), 4);
  const retryDelayMs = Math.max(options?.retryDelayMs ?? 900, 100);

  let lastTrigger = await triggerWorkerQueue({
    maxRuns: options?.maxRuns,
    reason: options?.reason,
    force: options?.force,
  });
  let attempt = 1;

  while (
    attempt < maxAttempts &&
    !lastTrigger.started &&
    !Boolean(lastTrigger.payload?.already_running)
  ) {
    await sleep(retryDelayMs * attempt);
    attempt += 1;
    lastTrigger = await triggerWorkerQueue({
      maxRuns: options?.maxRuns,
      reason: options?.reason ? `${options.reason}-retry-${attempt}` : `worker-start-retry-${attempt}`,
      force: options?.force,
    });
  }

  return buildWorkerQueueStartResult({
    trigger: lastTrigger,
    attempts: attempt,
  });
}

function mergeProgressPayload(
  inputPayload: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    inputPayload && typeof inputPayload === "object" && !Array.isArray(inputPayload)
      ? (inputPayload as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

export async function persistWorkerStartState(params: {
  supabase: SupabaseClient;
  runIds: string[];
  folderJobId?: string | null;
  result: WorkerQueueStartResult;
}) {
  const timestamp = new Date().toISOString();
  const { supabase, result } = params;
  const runIds = [...new Set(params.runIds.filter(Boolean))];

  if (runIds.length > 0) {
    const { data: runs, error: loadRunsError } = await supabase
      .from("ingestion_runs")
      .select("id,input_payload")
      .in("id", runIds);
    if (loadRunsError) {
      throw new Error(loadRunsError.message);
    }

    for (const run of runs ?? []) {
      const { error: updateRunError } = await supabase
        .from("ingestion_runs")
        .update({
          updated_at: timestamp,
          input_payload: mergeProgressPayload(run.input_payload, {
            progress_stage: result.progressStage,
            progress_message: result.progressMessage,
            progress_detail: result.progressDetail,
            progress_updated_at: timestamp,
            worker_trigger_attempts: result.attempts,
            worker_trigger_status: result.started
              ? "started"
              : result.alreadyRunning
                ? "waiting_for_worker"
                : "not_started",
            last_worker_trigger_status_code: result.trigger.status,
            last_worker_trigger_payload: result.trigger.payload,
            last_worker_trigger_at: timestamp,
          }),
        })
        .eq("id", run.id);

      if (updateRunError) {
        throw new Error(updateRunError.message);
      }
    }
  }

  if (params.folderJobId) {
    const { error: jobError } = await supabase
      .from("folder_analysis_jobs")
      .update({
        updated_at: timestamp,
        progress_stage: result.progressStage,
        progress_message: result.progressMessage,
        progress_detail: result.progressDetail,
      })
      .eq("id", params.folderJobId);

    if (jobError) {
      throw new Error(jobError.message);
    }
  }
}
