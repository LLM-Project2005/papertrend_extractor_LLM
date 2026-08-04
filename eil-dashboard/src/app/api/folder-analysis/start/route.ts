import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getDatabaseProvider } from "@/lib/server-env";
import { cloudSqlAnalysisJobRepository } from "@/lib/cloudsql/analysis-job-repository";
import { cloudSqlIngestionRepository } from "@/lib/cloudsql/ingestion-repository";
import {
  persistWorkerStartState,
  triggerWorkerQueueWithRetries,
  type WorkerQueueStartResult,
} from "@/lib/worker-queue-start";

export const runtime = "nodejs";

type StartBody = {
  folderJobId?: unknown;
};

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  const isAdmin = await isAuthorizedAdminRequest(request);
  if (!user && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as StartBody;
    const folderJobId = typeof body.folderJobId === "string" ? body.folderJobId.trim() : "";
    const useCloudSql = getDatabaseProvider() === "cloud-sql";
    const supabase = useCloudSql ? null : getSupabaseAdmin();

    if (useCloudSql && !user) {
      return NextResponse.json({ error: "Cloud SQL queue starts require an authenticated owner." }, { status: 401 });
    }

    let runs: Array<Record<string, unknown>>;
    if (useCloudSql) {
      runs = await cloudSqlAnalysisJobRepository.listActive(user!.id, folderJobId || null, 25);
    } else {
      let query = supabase!
        .from("ingestion_runs")
        .select("id,status,folder_analysis_job_id")
        .eq("source_type", "upload")
        .in("status", ["queued", "processing"])
        .order("created_at", { ascending: true })
        .limit(25);
      if (user) query = query.eq("owner_user_id", user.id);
      if (folderJobId) query = query.eq("folder_analysis_job_id", folderJobId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      runs = (data ?? []) as Array<Record<string, unknown>>;
    }

    const queuedRuns = (runs ?? []).filter((run) => run.status === "queued");
    const processingRuns = (runs ?? []).filter((run) => run.status === "processing");

    if (queuedRuns.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          queuedCount: 0,
          processingCount: processingRuns.length,
          message:
            processingRuns.length > 0
              ? "The worker is already processing active runs."
              : "There are no queued analysis runs to start.",
        },
        { status: 200 }
      );
    }

    let queueStart: WorkerQueueStartResult;
    try {
      queueStart = await triggerWorkerQueueWithRetries({
        maxRuns: Math.min(Math.max(queuedRuns.length, 1), 5),
        taskCount: queuedRuns.length,
        reason: "manual-start-processing",
        force: true,
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
        progressMessage: "Processing did not start",
        progressDetail:
          "The files are still queued because the app could not start the analysis worker.",
      };
    }

    const resolvedJobId = folderJobId || String(queuedRuns[0]?.folder_analysis_job_id ?? "");
    if (useCloudSql) {
      await cloudSqlIngestionRepository.persistWorkerStartState({
        ownerUserId: user!.id,
        runIds: queuedRuns.map((run) => String(run.id ?? "")).filter(Boolean),
        folderJobId: resolvedJobId,
        progressStage: queueStart.progressStage,
        progressMessage: queueStart.progressMessage,
        progressDetail: queueStart.progressDetail,
        metadata: { worker_trigger_attempts: queueStart.attempts, last_worker_trigger_payload: queueStart.trigger.payload },
      });
    } else {
      await persistWorkerStartState({
        supabase: supabase!,
        runIds: queuedRuns.map((run) => String(run.id ?? "")).filter(Boolean),
        folderJobId: resolvedJobId,
        result: queueStart,
      });
    }

    return NextResponse.json(
      {
        ok: queueStart.started || queueStart.alreadyRunning,
        queuedCount: queuedRuns.length,
        processingCount: processingRuns.length,
        queueStart,
      },
      { status: queueStart.started || queueStart.alreadyRunning ? 200 : 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start queued processing.",
      },
      { status: 500 }
    );
  }
}
