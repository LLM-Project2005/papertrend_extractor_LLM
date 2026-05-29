import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const STATUS_INPUT_PAYLOAD_KEYS = [
  "analysis_label",
  "analysis_mode",
  "progress_stage",
  "progress_message",
  "progress_detail",
  "source_kind",
  "recovery_count",
  "completion_recovery_count",
  "last_recovered_at",
  "paper_id",
  "raw_text_length",
  "keyword_count",
  "pipeline",
  "last_error_stage",
] as const;

function trimStatusInputPayload(inputPayload: unknown): Record<string, unknown> | null {
  if (!inputPayload || typeof inputPayload !== "object" || Array.isArray(inputPayload)) {
    return null;
  }

  const payload = inputPayload as Record<string, unknown>;
  const trimmed: Record<string, unknown> = {};
  for (const key of STATUS_INPUT_PAYLOAD_KEYS) {
    const value = payload[key];
    if (value !== undefined && value !== null) {
      trimmed[key] = value;
    }
  }
  return Object.keys(trimmed).length > 0 ? trimmed : null;
}

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
      .select(
        "id,owner_user_id,folder_id,folder_analysis_job_id,source_type,status,source_filename,display_name,source_extension,mime_type,file_size_bytes,provider,model,input_payload,error_message,created_at,updated_at,completed_at"
      )
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

    const compactRuns = (runs ?? []).map((run) => ({
      ...run,
      input_payload: trimStatusInputPayload(run.input_payload),
    }));

    return NextResponse.json({
      jobs: jobs ?? [],
      runs: compactRuns,
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
