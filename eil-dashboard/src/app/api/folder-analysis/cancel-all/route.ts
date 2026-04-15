import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type CancelAllBody = {
  folderJobId?: unknown;
};

type RunStatus = "queued" | "processing" | "succeeded" | "failed";

function summarizeStatuses(statuses: RunStatus[]) {
  const queued = statuses.filter((status) => status === "queued").length;
  const processing = statuses.filter((status) => status === "processing").length;
  const succeeded = statuses.filter((status) => status === "succeeded").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const total = statuses.length;

  let status: "queued" | "processing" | "succeeded" | "failed" = "succeeded";
  if (processing > 0) {
    status = "processing";
  } else if (queued > 0 && (succeeded > 0 || failed > 0)) {
    status = "processing";
  } else if (queued > 0) {
    status = "queued";
  } else if (failed > 0) {
    status = "failed";
  }

  return {
    status,
    total,
    queued,
    processing,
    succeeded,
    failed,
  };
}

async function syncFolderJobs(supabase: ReturnType<typeof getSupabaseAdmin>, jobIds: string[]) {
  const uniqueJobIds = [...new Set(jobIds.filter(Boolean))];
  if (uniqueJobIds.length === 0) {
    return;
  }

  for (const jobId of uniqueJobIds) {
    const { data: runs, error: runsError } = await supabase
      .from("ingestion_runs")
      .select("status")
      .eq("folder_analysis_job_id", jobId);

    if (runsError) {
      continue;
    }

    const statuses = (runs ?? [])
      .map((run) => String(run.status))
      .filter((status): status is RunStatus =>
        ["queued", "processing", "succeeded", "failed"].includes(status)
      );
    const summary = summarizeStatuses(statuses);
    const allTerminal = summary.queued === 0 && summary.processing === 0;

    await supabase
      .from("folder_analysis_jobs")
      .update({
        status: summary.status,
        total_runs: summary.total,
        queued_runs: summary.queued,
        processing_runs: summary.processing,
        succeeded_runs: summary.succeeded,
        failed_runs: summary.failed,
        progress_stage: allTerminal ? "failed" : "queued",
        progress_message: allTerminal ? "Canceled" : "Queued",
        progress_detail: allTerminal
          ? "All active analysis runs were canceled by the user."
          : "Some runs are still queued.",
        completed_at: allTerminal ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as CancelAllBody;
    const folderJobId = typeof body.folderJobId === "string" ? body.folderJobId.trim() : "";
    const supabase = getSupabaseAdmin();

    let runQuery = supabase
      .from("ingestion_runs")
      .select("id,folder_analysis_job_id,folder_id")
      .eq("owner_user_id", user.id)
      .eq("source_type", "upload")
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true })
      .limit(500);

    if (folderJobId) {
      runQuery = runQuery.eq("folder_analysis_job_id", folderJobId);
    }

    const { data: activeRuns, error: activeRunsError } = await runQuery;
    if (activeRunsError) {
      throw new Error(activeRunsError.message);
    }

    const activeRunIds = (activeRuns ?? []).map((run) => String(run.id));
    if (activeRunIds.length === 0) {
      return NextResponse.json({
        ok: true,
        canceledCount: 0,
        canceledRuns: [],
      });
    }

    const timestamp = new Date().toISOString();
    const { data: canceledRuns, error: cancelError } = await supabase
      .from("ingestion_runs")
      .update({
        status: "failed",
        error_message: "Canceled by user.",
        completed_at: timestamp,
        updated_at: timestamp,
      })
      .in("id", activeRunIds)
      .in("status", ["queued", "processing"])
      .select("id,folder_analysis_job_id,folder_id,status,error_message,updated_at,completed_at");

    if (cancelError) {
      throw new Error(cancelError.message);
    }

    const jobIds = (canceledRuns ?? [])
      .map((run) => String(run.folder_analysis_job_id ?? ""))
      .filter(Boolean);
    await syncFolderJobs(supabase, jobIds);

    const affectedFolderIds = [...new Set((canceledRuns ?? [])
      .map((run) => String(run.folder_id ?? ""))
      .filter(Boolean))];

    if (affectedFolderIds.length > 0) {
      await supabase
        .from("deep_research_sessions")
        .update({
          status: "queued",
          pending_run_count: 0,
          requires_analysis: false,
          updated_at: timestamp,
        })
        .eq("owner_user_id", user.id)
        .in("folder_id", affectedFolderIds)
        .eq("status", "waiting_on_analysis");
    }

    return NextResponse.json({
      ok: true,
      canceledCount: canceledRuns?.length ?? 0,
      canceledRuns: canceledRuns ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel active analysis runs.",
      },
      { status: 500 }
    );
  }
}
