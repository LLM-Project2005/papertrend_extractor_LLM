import { NextResponse } from "next/server";
import { z } from "zod";
import { isVerifiedTaskCaller } from "@/lib/cloud-tasks-oidc";
import { processProjectReclassificationJob } from "@/lib/project-reclassification-service";
import { getDatabaseProvider, projectAnalysisProfilesEnabled } from "@/lib/server-env";

export const runtime = "nodejs";
export const maxDuration = 600;
const Body = z.object({ jobId: z.string().uuid(), ownerUserId: z.string().uuid() });

export async function POST(request: Request) {
  // Only this service's own Cloud Tasks, by Google-signed identity token.
  if (!(await isVerifiedTaskCaller(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!projectAnalysisProfilesEnabled() || getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Repository profiles are not enabled." }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid job request." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await processProjectReclassificationJob(parsed.data.ownerUserId, parsed.data.jobId)) });
  } catch (error) {
    console.error("Project reclassification failed.", { jobId: parsed.data.jobId, ownerUserId: parsed.data.ownerUserId, message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
