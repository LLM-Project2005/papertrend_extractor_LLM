import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cancelReclassificationJob, failReclassificationJob, getReclassificationJob, retryReclassificationJob } from "@/lib/project-reclassification-repository";
import { enqueueProjectReclassificationJob } from "@/lib/project-reclassification-jobs";
import { getPublicRequestOrigin } from "@/lib/public-request-origin";
import { getDatabaseProvider, projectAnalysisProfilesEnabled } from "@/lib/server-env";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; jobId: string }> }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  const { projectId, jobId } = await params;
  const job = await getReclassificationJob(user.id, projectId, jobId);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Job not found." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; jobId: string }> }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  const { projectId, jobId } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action === "retry") {
    const job = await retryReclassificationJob(user.id, projectId, jobId);
    if (!job) return NextResponse.json({ error: "Failed job not found." }, { status: 404 });
    const queued = await enqueueProjectReclassificationJob(jobId, user.id, getPublicRequestOrigin(request));
    if (!queued) {
      await failReclassificationJob(user.id, jobId, new Error("Cloud Tasks could not enqueue the reclassification retry."));
      return NextResponse.json({ error: "Retry could not be queued." }, { status: 503 });
    }
    return NextResponse.json({ job });
  }
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "Action must be retry or cancel." }, { status: 400 });
  }
  const job = await cancelReclassificationJob(user.id, projectId, jobId);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Active job not found." }, { status: 404 });
}
