import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId");
    const jobId = url.searchParams.get("jobId");

    let jobQuery = supabase
      .from("folder_analysis_jobs")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (jobId) {
      jobQuery = jobQuery.eq("id", jobId);
    } else if (folderId && folderId !== "all") {
      jobQuery = jobQuery.eq("folder_id", folderId);
    }

    const { data: jobs, error: jobsError } = await jobQuery;
    if (jobsError) {
      throw new Error(jobsError.message);
    }

    let runQuery = supabase
      .from("ingestion_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25);

    if (jobId) {
      runQuery = runQuery.eq("folder_analysis_job_id", jobId);
    } else if (folderId && folderId !== "all") {
      runQuery = runQuery.eq("folder_id", folderId);
    }

    const { data: runs, error: runsError } = await runQuery;
    if (runsError) {
      throw new Error(runsError.message);
    }

    return NextResponse.json({
      jobs: jobs ?? [],
      runs: runs ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load folder analysis status.",
      },
      { status: 500 }
    );
  }
}
