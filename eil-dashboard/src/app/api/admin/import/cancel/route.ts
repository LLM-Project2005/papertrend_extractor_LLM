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
    const { data, error } = await supabase
      .from("ingestion_runs")
      .update({
        status: "failed",
        error_message: "Canceled by user.",
        completed_at: timestamp,
        updated_at: timestamp,
      })
      .in("id", runIds)
      .in("status", ["queued", "processing"])
      .select("*");

    if (error) {
      throw new Error(error.message);
    }

    console.info("[admin.import.cancel] canceled runs", {
      requestedCount: runIds.length,
      canceledCount: data?.length ?? 0,
    });

    return NextResponse.json({ runs: data ?? [] });
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
