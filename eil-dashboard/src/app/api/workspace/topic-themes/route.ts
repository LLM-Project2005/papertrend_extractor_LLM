import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { loadProjectTrends } from "@/lib/dashboard-data-server";
import { groupProjectThemes, projectBelongsTo, themeGroupingAvailable } from "@/lib/topic-theme-service";

export const runtime = "nodejs";
// A whole-repository grouping of 120 topics takes 10-15 seconds; filing a new
// paper's topics about 8. Firebase Hosting allows 60.
export const maxDuration = 60;

const BodySchema = z.object({ projectId: z.string().uuid() });

/**
 * Groups the repository's not-yet-grouped topics into themes, in this request.
 *
 * Called by the open dashboard when a read reports topics the stored grouping
 * has not seen. The owner is the signed-in user, never a value from the body,
 * and the repository must be theirs. Every outcome is a 200 with a status: a
 * failure is recorded and backed off server-side, so nothing here invites a
 * caller to retry in a loop.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid repository ID is required." }, { status: 400 });
  if (!themeGroupingAvailable()) return NextResponse.json({ status: "unavailable" });

  const { projectId } = parsed.data;
  try {
    if (!(await projectBelongsTo(user.id, projectId))) {
      return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    }
    const outcome = await groupProjectThemes(user.id, projectId, () => loadProjectTrends(user.id, projectId));
    return NextResponse.json(outcome);
  } catch (error) {
    console.error("topic_themes_request_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ status: "failed" });
  }
}
