import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cloudSqlAnalysisJobRepository } from "@/lib/cloudsql/analysis-job-repository";
import { getDatabaseProvider } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/** A batch is at most 50 uploads; a re-analysis at most 200 papers. */
const MAX_TRACKED_RUNS = 200;

const BodySchema = z.object({
  runIds: z.array(z.string().uuid()).min(1).max(MAX_TRACKED_RUNS),
  folderJobId: z.string().uuid().nullable().optional(),
});

/**
 * The progress of the runs the tray follows, by id (docs/32, 2.6). Only the
 * signed-in person's runs are returned, whatever ids are asked for.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose up to 200 runs to follow." }, { status: 400 });
  const runIds = [...new Set(parsed.data.runIds)];
  const folderJobId = parsed.data.folderJobId ?? null;

  try {
    if (getDatabaseProvider() === "cloud-sql") {
      const { runs, job } = await cloudSqlAnalysisJobRepository.trayStatus(user.id, runIds, folderJobId);
      return NextResponse.json({ runs, jobs: job ? [job] : [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const supabase = getSupabaseAdmin();
    const { data: runs, error } = await supabase
      .from("ingestion_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .in("id", runIds)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const jobs = folderJobId
      ? (await supabase.from("folder_analysis_jobs").select("*").eq("owner_user_id", user.id).eq("id", folderJobId).limit(1)).data ?? []
      : [];
    return NextResponse.json({ runs: runs ?? [], jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("tray_status_failed", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Progress could not be loaded just now." }, { status: 503 });
  }
}
