import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerWorkerQueue } from "@/lib/worker-trigger";

export const runtime = "nodejs";

type RecoveryBody = {
  staleMinutes?: number;
  maxRows?: number;
  triggerMaxRuns?: number;
  orphanJobMinutes?: number;
};

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function addRecoveryMetadata(inputPayload: unknown): Record<string, unknown> {
  const payload = asRecord(inputPayload);
  const previousCount = Number.parseInt(String(payload.recovery_count ?? 0), 10);
  const recoveryCount = Number.isFinite(previousCount) ? previousCount + 1 : 1;

  return {
    ...payload,
    analysis_mode: "automatic",
    analysis_label: "Automatic per-task model routing",
    recovery_count: recoveryCount,
    last_recovered_at: new Date().toISOString(),
    progress_stage: "queued",
    progress_message: "Recovered stalled analysis run",
    progress_detail:
      "A previous worker stopped updating this run, so it was returned to the queue manually.",
  };
}

export async function POST(request: Request) {
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as RecoveryBody;
    const staleMinutes = parseBoundedInt(body.staleMinutes, 20, 2, 1440);
    const orphanJobMinutes = parseBoundedInt(body.orphanJobMinutes, 10, 2, 1440);
    const maxRows = parseBoundedInt(body.maxRows, 50, 1, 500);
    const triggerMaxRuns = parseBoundedInt(body.triggerMaxRuns, 5, 1, 5);

    const staleBeforeIso = new Date(Date.now() - staleMinutes * 60_000).toISOString();
    const orphanBeforeIso = new Date(Date.now() - orphanJobMinutes * 60_000).toISOString();
    const nowIso = new Date().toISOString();

    const supabase = getSupabaseAdmin();

    const { data: staleRuns, error: staleRunsError } = await supabase
      .from("ingestion_runs")
      .select("id,input_payload")
      .eq("source_type", "upload")
      .eq("status", "processing")
      .lt("updated_at", staleBeforeIso)
      .order("updated_at", { ascending: true })
      .limit(maxRows);

    if (staleRunsError) {
      throw new Error(staleRunsError.message);
    }

    let requeuedRuns = 0;
    for (const run of staleRuns ?? []) {
      const { error: updateError } = await supabase
        .from("ingestion_runs")
        .update({
          status: "queued",
          completed_at: null,
          error_message: null,
          updated_at: nowIso,
          input_payload: addRecoveryMetadata(run.input_payload),
        })
        .eq("id", run.id)
        .eq("status", "processing");

      if (!updateError) {
        requeuedRuns += 1;
      }
    }

    const { data: candidateJobs, error: candidateJobsError } = await supabase
      .from("folder_analysis_jobs")
      .select("id")
      .in("status", ["queued", "processing"])
      .lt("updated_at", orphanBeforeIso)
      .order("updated_at", { ascending: true })
      .limit(maxRows);

    if (candidateJobsError) {
      throw new Error(candidateJobsError.message);
    }

    let failedOrphanJobs = 0;
    for (const job of candidateJobs ?? []) {
      const { count, error: countError } = await supabase
        .from("ingestion_runs")
        .select("id", { count: "exact", head: true })
        .eq("folder_analysis_job_id", job.id);

      if (countError) {
        continue;
      }
      if ((count ?? 0) > 0) {
        continue;
      }

      const { error: jobUpdateError } = await supabase
        .from("folder_analysis_jobs")
        .update({
          status: "failed",
          queued_runs: 0,
          processing_runs: 0,
          succeeded_runs: 0,
          failed_runs: 0,
          progress_stage: "failed",
          progress_message: "Failed",
          progress_detail:
            "No ingestion runs were found for this queued job. The job was marked failed during recovery.",
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", job.id)
        .in("status", ["queued", "processing"]);

      if (!jobUpdateError) {
        failedOrphanJobs += 1;
      }
    }

    const trigger = await triggerWorkerQueue({
      maxRuns: triggerMaxRuns,
      reason: "admin-manual-queue-recover",
    }).catch((error) => ({
      started: false,
      status: 0,
      payload: {
        skipped: true,
        reason: "trigger_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
    }));

    return NextResponse.json({
      ok: true,
      staleMinutes,
      orphanJobMinutes,
      scannedStaleRuns: staleRuns?.length ?? 0,
      requeuedRuns,
      scannedCandidateJobs: candidateJobs?.length ?? 0,
      failedOrphanJobs,
      workerTrigger: trigger,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to recover the ingestion queue.",
      },
      { status: 500 }
    );
  }
}
