import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  createGeneralAnalysisProfile,
  sanitizeProjectAnalysisProfile,
} from "@/lib/project-analysis-profile";
import { getWorkspaceRepository } from "@/lib/workspace-repository";
import { getClassificationCoverage } from "@/lib/project-reclassification-repository";
import { getDatabaseProvider, projectAnalysisProfilesEnabled } from "@/lib/server-env";
import type { ProjectAnalysisProfile } from "@/types/workspace";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { projectId: string } }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  const project = await getWorkspaceRepository().getProject(user.id, context.params.projectId);
  if (!project) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
  const profile = project.analysis_profile
    ? sanitizeProjectAnalysisProfile(project.analysis_profile)
    : createGeneralAnalysisProfile();
  const coverage = await getClassificationCoverage(user.id, project.id);
  return NextResponse.json({ profile, projectId: project.id, coverage });
}

export async function PUT(request: Request, context: { params: { projectId: string } }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  let profile: ProjectAnalysisProfile;
  try {
    const body = await request.json() as { profile?: unknown; analysisProfile?: unknown };
    profile = sanitizeProjectAnalysisProfile(body.analysisProfile ?? body.profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid analysis profile." },
      { status: 400 }
    );
  }
  try {
    const repository = getWorkspaceRepository();
    const current = await repository.getProject(user.id, context.params.projectId);
    if (!current) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const project = await repository.updateProject(user.id, current.id, {
      name: current.name,
      analysisProfile: profile,
    });
    return NextResponse.json({ profile: project?.analysis_profile ?? profile, project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update the analysis profile." },
      { status: 500 }
    );
  }
}
