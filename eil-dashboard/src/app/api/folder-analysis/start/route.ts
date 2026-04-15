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
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("ingestion_runs")
      .select("id,status,folder_analysis_job_id")
      .eq("source_type", "upload")
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true })
      .limit(25);

    if (user) {
      query = query.eq("owner_user_id", user.id);
    }
    if (folderJobId) {
      query = query.eq("folder_analysis_job_id", folderJobId);
    }

    const { data: runs, error } = await query;
    if (error) {
      throw new Error(error.message);
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
        reason: "manual-start-processing",
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

    await persistWorkerStartState({
      supabase,
      runIds: queuedRuns.map((run) => String(run.id ?? "")).filter(Boolean),
      folderJobId: folderJobId || String(queuedRuns[0]?.folder_analysis_job_id ?? ""),
      result: queueStart,
    });

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
