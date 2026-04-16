import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resetWorkerQueueLock } from "@/lib/worker-trigger";

export const runtime = "nodejs";

type ClearQueueBody = {
  folderJobId?: unknown;
};

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  const isAdmin = await isAuthorizedAdminRequest(request);
  if (!user && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as ClearQueueBody;
    const folderJobId = typeof body.folderJobId === "string" ? body.folderJobId.trim() : "";
    const supabase = getSupabaseAdmin();
    const timestamp = new Date().toISOString();

    let query = supabase
      .from("ingestion_runs")
      .select("id,input_payload,folder_analysis_job_id,folder_id")
      .eq("source_type", "upload")
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true })
      .limit(100);

    if (user) {
      query = query.eq("owner_user_id", user.id);
    }
    if (folderJobId) {
      query = query.eq("folder_analysis_job_id", folderJobId);
    }

    const { data: activeRuns, error: activeRunsError } = await query;
    if (activeRunsError) {
      throw new Error(activeRunsError.message);
    }

    const canceledRuns = [];
    for (const run of activeRuns ?? []) {
      const existingPayload =
        run.input_payload && typeof run.input_payload === "object" && !Array.isArray(run.input_payload)
          ? (run.input_payload as Record<string, unknown>)
          : {};
      const { data: canceledRun, error } = await supabase
        .from("ingestion_runs")
        .update({
          status: "failed",
          error_message: "Canceled by debug clear queue.",
          completed_at: timestamp,
          updated_at: timestamp,
          input_payload: {
            ...existingPayload,
            progress_stage: "failed",
            progress_message: "Analysis canceled by debug reset",
            progress_detail:
              "The queued or processing run was canceled during a debug queue reset.",
            progress_updated_at: timestamp,
            canceled_by_debug_reset: true,
          },
        })
        .eq("id", run.id)
        .in("status", ["queued", "processing"])
        .select("id,folder_analysis_job_id,folder_id,status,error_message,updated_at,completed_at,input_payload")
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (canceledRun) {
        canceledRuns.push(canceledRun);
      }
    }

    const jobIds = [...new Set(canceledRuns.map((run) => String(run.folder_analysis_job_id ?? "")).filter(Boolean))];
    for (const jobId of jobIds) {
      await supabase
        .from("folder_analysis_jobs")
        .update({
          status: "failed",
          progress_stage: "failed",
          progress_message: "Queue cleared by debug reset",
          progress_detail:
            "All queued or active runs for this batch were canceled and the worker gate was reset.",
          completed_at: timestamp,
          updated_at: timestamp,
        })
        .eq("id", jobId);
    }

    const workerReset = await resetWorkerQueueLock();

    return NextResponse.json({
      ok: workerReset.ok,
      canceledCount: canceledRuns.length,
      canceledRuns,
      workerReset,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to clear the worker queue.",
      },
      { status: 500 }
    );
  }
}
