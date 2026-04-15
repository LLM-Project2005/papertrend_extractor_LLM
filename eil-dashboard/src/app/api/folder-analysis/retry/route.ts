import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerWorkerQueue } from "@/lib/worker-trigger";

export const runtime = "nodejs";

type RetryBody = {
  folderJobId?: unknown;
};

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as RetryBody;
    const folderJobId = typeof body.folderJobId === "string" ? body.folderJobId.trim() : "";
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("ingestion_runs")
      .select("id", { count: "exact" })
      .eq("owner_user_id", user.id)
      .eq("source_type", "upload")
      .in("status", ["queued", "processing"])
      .limit(5);

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
