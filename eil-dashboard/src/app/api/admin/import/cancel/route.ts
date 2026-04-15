import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { run_ids } = (await request.json()) as { run_ids?: unknown };
    const runIds = Array.isArray(run_ids)
      ? [...new Set(run_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
      : [];

    if (runIds.length === 0) {
      return NextResponse.json(
        { error: "Provide at least one ingestion run id." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const timestamp = new Date().toISOString();
    const { data: activeRuns, error: activeRunsError } = await supabase
      .from("ingestion_runs")
      .select("*")
      .in("id", runIds)
      .in("status", ["queued", "processing"]);

    if (activeRunsError) {
      throw new Error(activeRunsError.message);
    }

    const data = [];
    for (const run of activeRuns ?? []) {
      const existingPayload =
        run.input_payload && typeof run.input_payload === "object" && !Array.isArray(run.input_payload)
          ? (run.input_payload as Record<string, unknown>)
          : {};
      const { data: canceledRun, error } = await supabase
        .from("ingestion_runs")
        .update({
          status: "failed",
          error_message: "Canceled by user.",
          completed_at: timestamp,
          updated_at: timestamp,
          input_payload: {
            ...existingPayload,
            progress_stage: "failed",
            progress_message: "Analysis canceled",
            progress_detail:
              "This run was canceled manually before the worker finished the analysis pipeline.",
            progress_updated_at: timestamp,
            canceled_by_user: true,
          },
        })
        .eq("id", run.id)
        .in("status", ["queued", "processing"])
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (canceledRun) {
        data.push(canceledRun);
      }
    }

    console.info("[admin.import.cancel] canceled runs", {
      requestedCount: runIds.length,
      canceledCount: data.length,
    });

    return NextResponse.json({ runs: data });
  } catch (error) {
    console.error("[admin.import.cancel] failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel ingestion runs.",
      },
      { status: 500 }
    );
  }
}
