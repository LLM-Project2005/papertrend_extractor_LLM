import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { sanitizeProjectAnalysisProfile } from "@/lib/project-analysis-profile";
import { getWorkspaceRepository } from "@/lib/workspace-repository";
import { getDatabaseProvider, projectAnalysisProfilesEnabled } from "@/lib/server-env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  const projects = await getWorkspaceRepository().listProjects(user.id);
  return NextResponse.json({
    templates: projects.flatMap((project) => {
      if (!project.analysis_profile) return [];
      try {
        return [{ projectId: project.id, projectName: project.name, profile: sanitizeProjectAnalysisProfile(project.analysis_profile) }];
      } catch {
        return [];
      }
    }),
  });
}
