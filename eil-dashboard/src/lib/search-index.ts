import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { loadRepositoryContext } from "@/lib/repository-chat";
import { syncRepositoryMemory } from "@/lib/repository-memory";

/**
 * Brings one analysed paper into the search index (docs/32, 2.3).
 *
 * The worker asks for this when a run succeeds, including after a
 * re-analysis, and again from its scheduled check for papers whose index is
 * older than their analysis. Before, papers were indexed only by a one-off
 * script, so every paper analysed since was missing from semantic search.
 *
 * The paper's chunks are stored with its repository, so repository-scoped
 * searches find them. A run that is not a succeeded, untrashed run of this
 * owner indexes nothing.
 */
export async function indexRunForSearch(
  ownerUserId: string,
  runId: string
): Promise<{ indexed: boolean; papers: number; chunks: number; embedded: number }> {
  const projectId = await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{ project_id: string }>(
      `SELECT rf.project_id::text AS project_id
       FROM public.ingestion_runs ir
       JOIN public.research_folders rf ON rf.id = ir.folder_id AND rf.owner_user_id = ir.owner_user_id
       WHERE ir.id = $1 AND ir.owner_user_id = $2 AND ir.status = 'succeeded' AND ir.trashed_at IS NULL
       LIMIT 1`,
      [runId, ownerUserId]
    );
    return result.rows[0]?.project_id ?? null;
  });
  if (!projectId) return { indexed: false, papers: 0, chunks: 0, embedded: 0 };
  const context = await loadRepositoryContext(
    { ownerUserId, projectId, selectedRunIds: [runId], prompt: "" },
    { saveCache: false }
  );
  if (context.papers.length === 0) return { indexed: false, papers: 0, chunks: 0, embedded: 0 };
  const result = await syncRepositoryMemory({ ownerUserId, projectId, folderId: null }, context.papers);
  return { indexed: true, ...result };
}
