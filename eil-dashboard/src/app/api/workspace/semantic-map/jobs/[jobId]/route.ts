import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSemanticMapJob } from "@/lib/semantic-map-repository";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { jobId: string } }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const map = await getSemanticMapJob(user.id, context.params.jobId);
    if (!map) return NextResponse.json({ error: "Map job not found." }, { status: 404 });
    return NextResponse.json({ map });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load map job." }, { status: 500 });
  }
}
