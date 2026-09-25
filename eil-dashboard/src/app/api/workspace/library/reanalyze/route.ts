import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cloudSqlAnalysisJobRepository } from "@/lib/cloudsql/analysis-job-repository";
import { getDatabaseProvider } from "@/lib/server-env";
import { triggerWorkerQueueWithRetries } from "@/lib/worker-queue-start";
import { REANALYSIS_COST_PER_PAPER_USD } from "@/lib/reanalysis";

export const runtime = "nodejs";

const MAX_RUNS_PER_REQUEST = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Analyse finished papers again with the current pipeline: one paper, a
 * selection, or a whole repository. The owner comes from the verified
 * session; run ids from the browser only narrow the owner's own runs.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Re-analysis needs the Cloud SQL workspace." }, { status: 501 });
  }

  const body = (await request.json().catch(() => ({}))) as { runIds?: unknown; projectId?: unknown };
  const runIds = Array.isArray(body.runIds)
    ? [...new Set(body.runIds.map(String).filter((id) => UUID_PATTERN.test(id)))].slice(0, MAX_RUNS_PER_REQUEST)
    : [];
  const projectId = typeof body.projectId === "string" && UUID_PATTERN.test(body.projectId) ? body.projectId : "";
  if (!runIds.length && !projectId) {
    return NextResponse.json({ error: "Choose papers or a repository to analyse again." }, { status: 400 });
  }

  try {
    const queued = await cloudSqlAnalysisJobRepository.queueReanalysis(
      user.id,
      runIds.length ? { runIds } : { projectId },
      MAX_RUNS_PER_REQUEST
    );
    if (!queued.length) {
      return NextResponse.json(
        { error: "None of these papers can be analysed again: only finished papers with a stored file qualify." },
        { status: 409 }
      );
    }
    const start = await triggerWorkerQueueWithRetries({
      maxRuns: Math.min(queued.length, 5),
      taskCount: queued.length,
      reason: "user-reanalysis",
    });
    return NextResponse.json({
      queuedRunIds: queued,
      queuedCount: queued.length,
      estimatedCostUsd: Number((queued.length * REANALYSIS_COST_PER_PAPER_USD).toFixed(2)),
      workerStarted: start.started || start.alreadyRunning,
      progressMessage: start.progressMessage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue the re-analysis." },
      { status: 500 }
    );
  }
}
