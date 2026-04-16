import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerWorkerQueue } from "@/lib/worker-trigger";

export const runtime = "nodejs";
const USER_STALE_REQUEUE_AFTER_MS = 3 * 60 * 1000;

type RetryBody = {
  folderJobId?: unknown;
};

function readProgressTimestamp(run: {
  updated_at?: string | null;
  input_payload?: Record<string, unknown> | null;
}): string | null {
  const payloadValue = run.input_payload?.progress_updated_at;
  return typeof payloadValue === "string" && payloadValue.trim()
    ? payloadValue
    : (run.updated_at ?? null);
}

function isStale(updatedAt: string | null, thresholdMs: number): boolean {
  if (!updatedAt) {
    return false;
  }
  const updatedEpoch = Date.parse(updatedAt);
  if (!Number.isFinite(updatedEpoch)) {
    return false;
  }
  return Date.now() - updatedEpoch >= thresholdMs;
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  const isAdmin = await isAuthorizedAdminRequest(request);
  if (!user && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as RetryBody;
    const folderJobId = typeof body.folderJobId === "string" ? body.folderJobId.trim() : "";
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("ingestion_runs")
      .select("id,status,updated_at,input_payload,folder_analysis_job_id", { count: "exact" })
      .eq("source_type", "upload")
      .in("status", ["queued", "processing"])
      .limit(5);

    if (user) {
      query = query.eq("owner_user_id", user.id);
    }

    if (folderJobId) {
      query = query.eq("folder_analysis_job_id", folderJobId);
    }

    const { data: activeRuns, count, error: countError } = await query;
    if (countError) {
      throw new Error(countError.message);
    }

    const activeCount = count ?? 0;
    if (activeCount === 0) {
      return NextResponse.json({
        ok: true,
        activeCount: 0,
        requeuedStaleCount: 0,
        trigger: { started: false, status: 0, payload: { skipped: true, reason: "no_active_runs" } },
      });
    }

    const staleProcessingRuns = (activeRuns ?? []).filter(
      (run) =>
        run.status === "processing" &&
        isStale(readProgressTimestamp(run), USER_STALE_REQUEUE_AFTER_MS)
    );

    let requeuedStaleCount = 0;
    if (staleProcessingRuns.length > 0) {
      const timestamp = new Date().toISOString();
      for (const run of staleProcessingRuns) {
        const existingPayload =
          run.input_payload && typeof run.input_payload === "object" && !Array.isArray(run.input_payload)
            ? (run.input_payload as Record<string, unknown>)
            : {};
        const recoveryCount =
          typeof existingPayload.recovery_count === "number"
            ? existingPayload.recovery_count
            : Number(existingPayload.recovery_count ?? 0) || 0;

        const { error: updateError } = await supabase
          .from("ingestion_runs")
          .update({
            status: "queued",
            completed_at: null,
            error_message: null,
            updated_at: timestamp,
            input_payload: {
              ...existingPayload,
              analysis_mode: "automatic",
              analysis_label: "Automatic per-task model routing",
              recovery_count: recoveryCount + 1,
              last_recovered_at: timestamp,
              progress_stage: "queued",
              progress_message: "Recovered stalled analysis run",
              progress_detail:
                "This run had stopped updating for several minutes, so the retry action returned it to the queue.",
              progress_updated_at: timestamp,
            },
          })
          .eq("id", run.id)
          .eq("status", "processing");

        if (updateError) {
          throw new Error(updateError.message);
        }
        requeuedStaleCount += 1;
      }

      if (folderJobId) {
        await supabase
          .from("folder_analysis_jobs")
          .update({
            status: "queued",
            progress_stage: "queued",
            progress_message: "Recovered stalled analysis runs",
            progress_detail:
              "One or more stalled runs were returned to the queue and are ready for the worker to pick up again.",
            updated_at: timestamp,
            completed_at: null,
          })
          .eq("id", folderJobId);
      }
    }

    const trigger = await triggerWorkerQueue({
      maxRuns: Math.min(Math.max(activeCount, 1), 5),
      reason: requeuedStaleCount > 0 ? "user-force-requeue-stale-analysis" : "user-retry-folder-analysis",
    });

    if (!trigger.started) {
      const reason = String((trigger.payload?.reason as string) || "unknown_reason");
      const alreadyRunning = Boolean(trigger.payload?.already_running);
      return NextResponse.json(
        {
          error:
            alreadyRunning
              ? requeuedStaleCount > 0
                ? "Stalled runs were returned to the queue, but the analysis worker is still busy with another batch right now."
                : "The analysis worker is already busy with another batch, so this retry could not start a new one yet."
              : reason === "missing_worker_config"
                ? "Worker service is not configured (WORKER_SERVICE_URL/WORKER_WEBHOOK_SECRET)."
                : "Worker trigger did not start processing.",
          activeCount,
          requeuedStaleCount,
          trigger,
        },
        { status: alreadyRunning ? 409 : 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      activeCount,
      requeuedStaleCount,
      trigger,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to retry processing.",
      },
      { status: 500 }
    );
  }
}
