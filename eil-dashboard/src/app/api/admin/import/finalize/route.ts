import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  persistWorkerStartState,
  triggerWorkerQueueWithRetries,
  type WorkerQueueStartResult,
} from "@/lib/worker-queue-start";

export const runtime = "nodejs";

type UploadFinalizeItem = {
  runId: string;
  storagePath: string;
  fileName?: string;
  errorMessage?: string;
};

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
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const supabase = getSupabaseAdmin();
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

    let query = supabase
      .from("ingestion_runs")
      .select("id,owner_user_id,folder_analysis_job_id,input_payload")
      .in("id", allRunIds)
      .eq("folder_analysis_job_id", folderJobId);

    if (user?.id) {
      query = query.eq("owner_user_id", user.id);
    }

    const { data: runRows, error: runRowsError } = await query;

    if (runRowsError) {
      throw new Error(runRowsError.message);
    }

    const validRunIds = new Set((runRows ?? []).map((row) => String(row.id ?? "")).filter(Boolean));
    const validUploadedItems = uploaded.filter((item) => validRunIds.has(String(item.runId)));
    const validFailedItems = failed.filter((item) => validRunIds.has(String(item.runId)));

    const timestamp = new Date().toISOString();

    for (const item of validUploadedItems) {
      const row = (runRows ?? []).find((entry) => String(entry.id) === String(item.runId));
      const basePayload =
        row?.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload)
          ? (row.input_payload as Record<string, unknown>)
          : {};

      const { error: updateError } = await supabase
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

    for (const item of validFailedItems) {
      const row = (runRows ?? []).find((entry) => String(entry.id) === String(item.runId));
      const basePayload =
        row?.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload)
          ? (row.input_payload as Record<string, unknown>)
          : {};

      const { error: updateError } = await supabase
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

    const queuedCount = validUploadedItems.length;
    const failedCount = validFailedItems.length;

    const { data: folderJobAfterUpdate, error: folderJobUpdateError } = await supabase
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
        supabase,
        runIds: validUploadedItems.map((item) => item.runId),
        folderJobId,
        result: queueStart,
      });
    }

    const { data: runs, error: runsError } = await supabase
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
