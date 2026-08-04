import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedUserOrAdminRequest,
} from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cloudSqlIngestionRepository } from "@/lib/cloudsql/ingestion-repository";
import {
  persistWorkerStartState,
  triggerWorkerQueueWithRetries,
  type WorkerQueueStartResult,
} from "@/lib/worker-queue-start";
import { getDatabaseProvider, getWorkerServiceUrl, getWorkerWebhookSecret } from "@/lib/server-env";

export const runtime = "nodejs";

type UploadFinalizeItem = {
  runId: string;
  storagePath: string;
  fileName?: string;
  errorMessage?: string;
};

function isSafePendingStoragePath(storagePath: string, runId: string): boolean {
  const normalizedPath = storagePath.startsWith("gs://")
    ? storagePath.replace(/^gs:\/\/[^/]+\//, "")
    : storagePath;
  return (
    normalizedPath.startsWith("pending/") &&
    normalizedPath.includes(`/${runId}/`) &&
    !normalizedPath.includes("..") &&
    !normalizedPath.includes("\\")
  );
}

async function gcsObjectExists(storagePath: string): Promise<boolean> {
  if (!storagePath.startsWith("gs://")) {
    return false;
  }
  const workerServiceUrl = getWorkerServiceUrl();
  const workerSecret = getWorkerWebhookSecret();
  if (!workerServiceUrl || !workerSecret) {
    return false;
  }

  try {
    const response = await fetch(`${workerServiceUrl}/gcs/object-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ storagePath }),
    });
    const payload = (await response.json().catch(() => null)) as {
      exists?: boolean;
    } | null;
    return response.ok && Boolean(payload?.exists);
  } catch {
    return false;
  }
}

function buildNotStartedResult(reason: string): WorkerQueueStartResult {
  return {
    started: false,
    alreadyRunning: false,
    attempts: 0,
    trigger: {
      started: false,
      status: 0,
      payload: { reason },
    },
    progressStage: "queued_but_unstarted",
    progressMessage: "Upload succeeded, but processing did not start",
    progressDetail:
      "The files were uploaded successfully, but analysis processing could not be started for this batch.",
  };
}

export async function POST(request: Request) {
  if (!(await isAuthorizedUserOrAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const databaseProvider = getDatabaseProvider();
    const supabase = databaseProvider === "supabase" ? getSupabaseAdmin() : null;
    const body = (await request.json()) as {
      folderJobId?: string;
      uploaded?: UploadFinalizeItem[];
      failed?: UploadFinalizeItem[];
    };

    const folderJobId = String(body.folderJobId ?? "").trim();
    const uploaded = Array.isArray(body.uploaded) ? body.uploaded : [];
    const failed = Array.isArray(body.failed) ? body.failed : [];

    if (!folderJobId) {
      return NextResponse.json({ error: "folderJobId is required." }, { status: 400 });
    }

    const uploadedRunIds = uploaded.map((item) => String(item.runId || "").trim()).filter(Boolean);
    const failedRunIds = failed.map((item) => String(item.runId || "").trim()).filter(Boolean);

    if (uploadedRunIds.length === 0 && failedRunIds.length === 0) {
      return NextResponse.json(
        { error: "No uploaded or failed items were provided." },
        { status: 400 }
      );
    }

    const allRunIds = [...new Set([...uploadedRunIds, ...failedRunIds])];

    if (!user?.id) {
      return NextResponse.json({ error: "An authenticated owner is required." }, { status: 401 });
    }
    let runRows: Array<Record<string, unknown>>;
    if (databaseProvider === "cloud-sql") {
      runRows = await cloudSqlIngestionRepository.loadOwnedBatch(
        user.id,
        folderJobId,
        allRunIds
      ) as unknown as Array<Record<string, unknown>>;
    } else {
      const { data, error } = await supabase!
        .from("ingestion_runs")
        .select("id,owner_user_id,folder_analysis_job_id,input_payload")
        .in("id", allRunIds)
        .eq("folder_analysis_job_id", folderJobId)
        .eq("owner_user_id", user.id);
      if (error) throw new Error(error.message);
      runRows = (data ?? []) as Array<Record<string, unknown>>;
    }

    const validRunIds = new Set(runRows.map((row) => String(row.id ?? "")).filter(Boolean));
    const validUploadedItems = uploaded.filter((item) => {
      const runId = String(item.runId);
      const storagePath = String(item.storagePath ?? "");
      return validRunIds.has(runId) && isSafePendingStoragePath(storagePath, runId);
    });
    const validFailedItems = failed.filter((item) => validRunIds.has(String(item.runId)));
    const recoveredUploadedItems: UploadFinalizeItem[] = [];
    const remainingFailedItems: UploadFinalizeItem[] = [];

    for (const item of validFailedItems) {
      const runId = String(item.runId);
      const storagePath = String(item.storagePath ?? "");
      if (
        isSafePendingStoragePath(storagePath, runId) &&
        storagePath.startsWith("gs://") &&
        (await gcsObjectExists(storagePath))
      ) {
        recoveredUploadedItems.push({
          ...item,
          errorMessage: undefined,
        });
      } else {
        remainingFailedItems.push(item);
      }
    }

    const queueableUploadedItems = [...validUploadedItems, ...recoveredUploadedItems];

    if (databaseProvider === "cloud-sql") {
      const finalized = await cloudSqlIngestionRepository.finalizeBatch({
        ownerUserId: user.id,
        folderJobId,
        uploaded: queueableUploadedItems.map((item) => ({
          runId: String(item.runId), storagePath: String(item.storagePath),
        })),
        failed: remainingFailedItems.map((item) => ({
          runId: String(item.runId), errorMessage: item.errorMessage,
        })),
      });
      let queueStart = buildNotStartedResult("no_uploaded_runs");
      if (queueableUploadedItems.length > 0) {
        queueStart = await triggerWorkerQueueWithRetries({
          maxRuns: Math.min(queueableUploadedItems.length, 5),
          taskCount: queueableUploadedItems.length,
          reason: "admin-import-direct-upload",
        });
        await cloudSqlIngestionRepository.persistWorkerStartState({
          ownerUserId: user.id,
          runIds: queueableUploadedItems.map((item) => String(item.runId)),
          folderJobId,
          progressStage: queueStart.progressStage,
          progressMessage: queueStart.progressMessage,
          progressDetail: queueStart.progressDetail,
          metadata: {
            worker_trigger_attempts: queueStart.attempts,
            worker_trigger_status: queueStart.started ? "started" : queueStart.alreadyRunning ? "waiting_for_worker" : "not_started",
            last_worker_trigger_status_code: queueStart.trigger.status,
            last_worker_trigger_payload: queueStart.trigger.payload,
          },
        });
      }
      return NextResponse.json({
        runs: finalized.runs,
        folderJob: finalized.folderJob,
        queueStart,
        warning: queueStart.started || queueStart.alreadyRunning ? null : queueStart.progressMessage,
      }, { status: queueableUploadedItems.length > 0 ? 201 : 202 });
    }

    const timestamp = new Date().toISOString();

    for (const item of queueableUploadedItems) {
      const row = runRows.find((entry) => String(entry.id) === String(item.runId));
      const basePayload =
        row?.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload)
          ? (row.input_payload as Record<string, unknown>)
          : {};

      const { error: updateError } = await supabase!
        .from("ingestion_runs")
        .update({
          status: "queued",
          source_path: item.storagePath,
          error_message: null,
          completed_at: null,
          updated_at: timestamp,
          input_payload: {
            ...basePayload,
            progress_stage: "queued",
            progress_message: "Queued",
            progress_detail: "Upload complete. Waiting for worker to claim this file.",
            uploaded_at: timestamp,
          },
        })
        .eq("id", item.runId)
        .eq("folder_analysis_job_id", folderJobId);

      if (updateError) {
        throw new Error(updateError.message);
      }
    }

    for (const item of remainingFailedItems) {
      const row = runRows.find((entry) => String(entry.id) === String(item.runId));
      const basePayload =
        row?.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload)
          ? (row.input_payload as Record<string, unknown>)
          : {};

      const { error: updateError } = await supabase!
        .from("ingestion_runs")
        .update({
          status: "failed",
          error_message: item.errorMessage || "Direct upload failed before queueing.",
          updated_at: timestamp,
          completed_at: timestamp,
          input_payload: {
            ...basePayload,
            progress_stage: "failed",
            progress_message: "Upload failed",
            progress_detail: item.errorMessage || "File upload failed before queueing analysis.",
            upload_failed_at: timestamp,
          },
        })
        .eq("id", item.runId)
        .eq("folder_analysis_job_id", folderJobId);

      if (updateError) {
        throw new Error(updateError.message);
      }
    }

    const queuedCount = queueableUploadedItems.length;
    const failedCount = remainingFailedItems.length;

    const { data: folderJobAfterUpdate, error: folderJobUpdateError } = await supabase!
      .from("folder_analysis_jobs")
      .update({
        status: queuedCount > 0 ? "queued" : "failed",
        queued_runs: queuedCount,
        processing_runs: 0,
        failed_runs: failedCount,
        progress_stage: queuedCount > 0 ? "queued" : "failed",
        progress_message:
          queuedCount > 0 ? "Queued" : "Upload failed before queueing",
        progress_detail:
          queuedCount > 0
            ? `Queued ${queuedCount} file${queuedCount === 1 ? "" : "s"} for processing.${failedCount > 0 ? ` ${failedCount} failed during upload.` : ""}`
            : "All files in this batch failed during upload.",
        updated_at: timestamp,
        completed_at: queuedCount > 0 ? null : timestamp,
      })
      .eq("id", folderJobId)
      .select("*")
      .single();

    if (folderJobUpdateError || !folderJobAfterUpdate) {
      throw new Error(folderJobUpdateError?.message ?? "Failed to update folder job.");
    }

    let queueStart: WorkerQueueStartResult = buildNotStartedResult("no_uploaded_runs");
    if (queuedCount > 0) {
      try {
        queueStart = await triggerWorkerQueueWithRetries({
          maxRuns: Math.min(queuedCount, 5),
          taskCount: queuedCount,
          reason: "admin-import-direct-upload",
        });
      } catch (triggerError) {
        queueStart = {
          started: false,
          alreadyRunning: false,
          attempts: 1,
          trigger: {
            started: false,
            status: 0,
            payload: {
              reason: "trigger_exception",
              message:
                triggerError instanceof Error ? triggerError.message : "unknown_error",
            },
          },
          progressStage: "queued_but_unstarted",
          progressMessage: "Upload succeeded, but processing did not start",
          progressDetail:
            "The files were uploaded successfully, but the app could not reach the analysis worker. Use “Start processing now” to retry once worker connectivity is restored.",
        };
      }

      await persistWorkerStartState({
        supabase: supabase!,
        runIds: queueableUploadedItems.map((item) => item.runId),
        folderJobId,
        result: queueStart,
      });
    }

    const { data: runs, error: runsError } = await supabase!
      .from("ingestion_runs")
      .select("*")
      .eq("folder_analysis_job_id", folderJobId)
      .order("created_at", { ascending: false });

    if (runsError) {
      throw new Error(runsError.message);
    }

    return NextResponse.json(
      {
        runs: runs ?? [],
        folderJob: folderJobAfterUpdate,
        queueStart,
        warning: queueStart.started || queueStart.alreadyRunning ? null : queueStart.progressMessage,
      },
      { status: queuedCount > 0 ? 201 : 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to finalize uploads.",
      },
      { status: 500 }
    );
  }
}
