import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getWorkspaceRepository } from "@/lib/workspace-repository";
import { createReclassificationJob, failReclassificationJob } from "@/lib/project-reclassification-repository";
import { enqueueProjectReclassificationJob } from "@/lib/project-reclassification-jobs";
import { processProjectReclassificationJob } from "@/lib/project-reclassification-service";
import { getPublicRequestOrigin } from "@/lib/public-request-origin";
import { getDatabaseProvider, projectAnalysisProfilesEnabled } from "@/lib/server-env";
import { sanitizeProjectAnalysisProfile } from "@/lib/project-analysis-profile";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  const { projectId } = await params;
  try {
    const project = await getWorkspaceRepository().getProject(user.id, projectId);
    if (!project) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const profile = sanitizeProjectAnalysisProfile(project.analysis_profile);
    const job = await createReclassificationJob(user.id, projectId, profile);
    if (process.env.RECLASSIFICATION_INLINE_JOBS === "true") {
      await processProjectReclassificationJob(user.id, job.id);
      return NextResponse.json({ jobId: job.id, queued: false }, { status: 201 });
    }
    const queued = await enqueueProjectReclassificationJob(job.id, user.id, getPublicRequestOrigin(request));
    if (!queued) {
      await failReclassificationJob(user.id, job.id, new Error("Cloud Tasks could not enqueue reclassification."));
      return NextResponse.json({ error: "Reclassification could not be queued.", jobId: job.id }, { status: 503 });
    }
    return NextResponse.json({ jobId: job.id, queued: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start reclassification." }, { status: 500 });
  }
}
