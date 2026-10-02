import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cloudSqlLibraryRepository, LibraryActionError, MAX_BULK_RUNS } from "@/lib/cloudsql/library-repository";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const BulkSchema = z.object({
  action: z.enum(["trash", "restore", "move"]),
  runIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_RUNS),
  folderId: z.string().uuid().optional(),
});

/**
 * Trash, restore or move several papers at once (docs/32, 4.5). The owner
 * comes from the verified session; the run ids only narrow the owner's own
 * runs. Re-analysis and retry of a selection go through /reanalyze, and
 * permanent deletion through /trash, which already take many.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Bulk actions need the Cloud SQL workspace." }, { status: 501 });
  }
  const parsed = BulkSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: `Choose between 1 and ${MAX_BULK_RUNS} papers, and a folder to move them to.` }, { status: 400 });
  }
  try {
    const result = await cloudSqlLibraryRepository.bulkUpdateRuns(user.id, parsed.data);
    return NextResponse.json({ runs: result.runs, changed: result.runs.length, skipped: result.skipped });
  } catch (error) {
    if (error instanceof LibraryActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("A bulk library action failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The papers couldn't be changed right now." }, { status: 503 });
  }
}
