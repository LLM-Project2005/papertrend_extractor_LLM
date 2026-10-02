import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import {
  crossrefConcurrency,
  fetchCrossrefJson,
  loadReferencePapers,
  MAX_REFERENCE_RUNS,
  resolveReferences,
  saveCitationCacheIn,
} from "@/lib/references/resolve";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";
// Looking up a large selection for the first time can take Crossref a while.
export const maxDuration = 60;

const ReferencesSchema = z.union([
  z.object({ runIds: z.array(z.string().uuid()).min(1).max(MAX_REFERENCE_RUNS) }),
  z.object({ projectId: z.string().uuid() }),
]);

/**
 * The reference details of selected papers, or a repository's (docs/32, 4.4);
 * the browser writes them as BibTeX, RIS or APA (src/lib/references/citation.ts).
 * The owner comes from the verified session; run ids and the repository only
 * narrow the owner's own papers.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "References need the Cloud SQL workspace." }, { status: 501 });
  }
  const parsed = ReferencesSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: `Choose up to ${MAX_REFERENCE_RUNS} papers, or a repository.` }, { status: 400 });
  }
  const selection = "runIds" in parsed.data ? { runIds: parsed.data.runIds } : { projectId: parsed.data.projectId };
  try {
    const rows = await withCloudSqlOwnerTransaction(user.id, (client) => loadReferencePapers(client, user.id, selection));
    if (rows.length === 0) {
      return NextResponse.json({ error: "None of these papers has finished its analysis yet." }, { status: 404 });
    }
    // Within the route's 60 s: what is not looked up by then is next time.
    const resolved = await resolveReferences(rows, {
      fetchJson: (url) => fetchCrossrefJson(url),
      concurrency: crossrefConcurrency(),
      deadlineMs: 40_000,
    });
    if (resolved.cacheWrites.length) {
      await withCloudSqlOwnerTransaction(user.id, (client) => saveCitationCacheIn(client, user.id, resolved.cacheWrites)).catch((error) =>
        console.warn("Keeping reference lookups failed.", { message: error instanceof Error ? error.message : "unknown_error" })
      );
    }
    return NextResponse.json(
      {
        records: resolved.records,
        fromCrossref: resolved.fromCrossref,
        titleOnly: resolved.titleOnly,
        notLookedUp: resolved.notLookedUp,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Exporting references failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The references couldn't be made right now." }, { status: 503 });
  }
}
