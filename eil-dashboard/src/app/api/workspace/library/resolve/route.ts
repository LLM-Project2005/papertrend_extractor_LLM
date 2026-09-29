import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/*
 * Which Library file a paper came from, so a paper named anywhere - a chart,
 * a citation, a search result - can open in place. A paper's id is the first
 * 15 hex digits of its run's id (paper-id.ts), so the run is found by that
 * prefix; a Library copy of it is used only when the original is in Trash.
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Not available here." }, { status: 404 });
  }
  const paperId = new URL(request.url).searchParams.get("paperId")?.trim() ?? "";
  if (!/^\d{1,20}$/.test(paperId)) return NextResponse.json({ error: "A paper id is required." }, { status: 400 });
  let prefix: string;
  try {
    prefix = BigInt(paperId).toString(16).padStart(15, "0");
  } catch {
    return NextResponse.json({ error: "A paper id is required." }, { status: 400 });
  }
  if (prefix.length !== 15) return NextResponse.json({ error: "Paper not found." }, { status: 404 });

  const result = await withCloudSqlOwnerTransaction(user.id, (client) =>
    client.query<{ id: string }>(
      `SELECT id::text
       FROM public.ingestion_runs
       WHERE owner_user_id = $1
         AND trashed_at IS NULL
         AND (left(replace(id::text, '-', ''), 15) = $2
              OR left(replace(copied_from_run_id::text, '-', ''), 15) = $2)
       ORDER BY (left(replace(id::text, '-', ''), 15) = $2) DESC, updated_at DESC
       LIMIT 1`,
      [user.id, prefix]
    )
  );
  const runId = result.rows[0]?.id;
  if (!runId) return NextResponse.json({ error: "Paper not found." }, { status: 404 });
  return NextResponse.json({ runId });
}
