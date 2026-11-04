import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { deleteSelectedRuns } from "@/lib/cloudsql/permanent-delete";

/*
 * Deleting a whole repository (Settings > General > Delete repository,
 * 2026-11-05). One owner-scoped transaction, so a failure leaves it as it was:
 *
 *  - every paper in it, in Trash or not, goes the way "Delete permanently"
 *    takes a paper (permanent-delete.ts): its analysis, its upload fingerprint,
 *    and its file once no other run uses it. A copy made into another
 *    repository keeps the paper they share;
 *  - the repository's row, which takes its folders, Tables, Semantic Maps,
 *    research areas, reclassification jobs and chat jobs with it (ON DELETE
 *    CASCADE from workspace_projects and research_folders);
 *  - its cached dashboard figures.
 *
 * Chats stay: a conversation belongs to the account, not to one repository.
 * A repository with a paper still being analysed is not deleted, because the
 * worker would write into it after it had gone.
 */

export class RepositoryDeleteRefused extends Error {}

export interface RepositoryDeleteResult {
  deletedRuns: number;
  /** gs:// paths no remaining run uses, to remove from storage after commit. */
  orphanedObjects: string[];
}

export async function deleteRepositoryWithin(
  client: PoolClient,
  ownerUserId: string,
  projectId: string,
  /** The name the reader typed; null when the whole account is going. */
  confirmName: string | null
): Promise<RepositoryDeleteResult> {
  const project = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.workspace_projects WHERE id = $1 AND owner_user_id = $2 FOR UPDATE`,
    [projectId, ownerUserId]
  );
  if (project.rowCount === 0) throw new RepositoryDeleteRefused("That repository was not found.");
  if (confirmName !== null && confirmName.trim() !== project.rows[0].name.trim()) {
    throw new RepositoryDeleteRefused("The name you typed doesn't match the repository's name.");
  }

  const busy = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM public.ingestion_runs r
     JOIN public.research_folders f ON f.id = r.folder_id AND f.owner_user_id = r.owner_user_id
     WHERE r.owner_user_id = $1 AND f.project_id = $2 AND r.status IN ('queued', 'processing')`,
    [ownerUserId, projectId]
  );
  const analysing = Number(busy.rows[0]?.count ?? 0);
  if (analysing > 0) {
    throw new RepositoryDeleteRefused(
      `${analysing} paper${analysing === 1 ? " is" : "s are"} still being analysed. Delete the repository when ${analysing === 1 ? "it has" : "they have"} finished.`
    );
  }

  const runs = await client.query<{ id: string; source_path: string | null; project_id: string | null }>(
    `SELECT r.id, r.source_path, f.project_id
     FROM public.ingestion_runs r
     JOIN public.research_folders f ON f.id = r.folder_id AND f.owner_user_id = r.owner_user_id
     WHERE r.owner_user_id = $1 AND f.project_id = $2
     FOR UPDATE OF r`,
    [ownerUserId, projectId]
  );
  const deleted = await deleteSelectedRuns(client, ownerUserId, runs.rows);

  await client.query(
    `DELETE FROM public.workspace_analytics_cache
     WHERE owner_user_id = $1 AND scope_type = 'project' AND scope_key = $2`,
    [ownerUserId, projectId]
  );
  await client.query(`DELETE FROM public.workspace_projects WHERE id = $1 AND owner_user_id = $2`, [projectId, ownerUserId]);

  return { deletedRuns: deleted.deletedRunIds.length, orphanedObjects: deleted.orphanedObjects };
}

export function deleteRepository(ownerUserId: string, projectId: string, confirmName: string): Promise<RepositoryDeleteResult> {
  return withCloudSqlOwnerTransaction(ownerUserId, (client) => deleteRepositoryWithin(client, ownerUserId, projectId, confirmName));
}
