import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerWorkerQueue } from "@/lib/worker-trigger";

export const runtime = "nodejs";

type RetryBody = {
  folderJobId?: unknown;
};

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
      .select("id", { count: "exact" })
      .eq("source_type", "upload")
      .in("status", ["queued", "processing"])
      .limit(5);

    if (user) {
      query = query.eq("owner_user_id", user.id);
    }

    if (folderJobId) {
      query = query.eq("folder_analysis_job_id", folderJobId);
    }

    const { count, error: countError } = await query;
    if (countError) {
      throw new Error(countError.message);
    }

    const activeCount = count ?? 0;
    if (activeCount === 0) {
      return NextResponse.json({
        ok: true,
        activeCount: 0,
        trigger: { started: false, status: 0, payload: { skipped: true, reason: "no_active_runs" } },
      });
    }

    const trigger = await triggerWorkerQueue({
      maxRuns: Math.min(Math.max(activeCount, 1), 5),
      reason: "user-retry-folder-analysis",
    });

    if (!trigger.started) {
      const reason = String((trigger.payload?.reason as string) || "unknown_reason");
      return NextResponse.json(
        {
          error:
            reason === "missing_worker_config"
              ? "Worker service is not configured (WORKER_SERVICE_URL/WORKER_WEBHOOK_SECRET)."
              : "Worker trigger did not start processing.",
          activeCount,
          trigger,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      activeCount,
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
