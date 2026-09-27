import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { paperIdFromRunId } from "@/lib/paper-id";
import { markProjectSemanticMapsStale } from "@/lib/semantic-map-invalidation";

/*
 * Deleting papers for good, from Trash only.
 *
 * Everything is removed in one owner-scoped transaction, so a failure part way
 * leaves the paper exactly as it was:
 *  - the paper's row, which takes every analysis table with it (keywords,
 *    topics, categories, sections, embeddings, retrieval chunks: all
 *    ON DELETE CASCADE from papers). A copy made with "Make a copy" shares
 *    its original's paper, so a paper still used by a run that stays is kept;
 *  - links to the run from rows without a delete rule of their own (the
 *    content row, copies made from it) are cleared, and its upload
 *    fingerprint goes, so the same PDF can be added again later;
 *  - the run itself;
 *  - the repository's cached dashboard figures, and its semantic maps are
 *    marked out of date.
 *
 * The stored file is removed afterwards, and only when no other run still
 * uses it ("Make a copy" shares the original's file). Storage is not part of
 * the transaction, so a file that fails to delete is logged and left behind
 * rather than undoing the delete.
 *
 * Every statement filters on owner_user_id as well as the transaction's owner
 * context, and only runs already in Trash qualify.
 */

export interface PermanentDeleteResult {
  deletedRunIds: string[];
  /** gs:// paths no remaining run uses, to remove from storage after commit. */
  orphanedObjects: string[];
}

export async function permanentlyDeleteTrashedRuns(
  ownerUserId: string,
  runIds: string[] | "all"
): Promise<PermanentDeleteResult> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    type SelectedRun = { id: string; source_path: string | null; project_id: string | null };
    const selected =
      runIds === "all"
        ? await client.query<SelectedRun>(
            `SELECT r.id, r.source_path, f.project_id
             FROM public.ingestion_runs r
             LEFT JOIN public.research_folders f ON f.id = r.folder_id AND f.owner_user_id = r.owner_user_id
             WHERE r.owner_user_id = $1 AND r.trashed_at IS NOT NULL
             FOR UPDATE OF r`,
            [ownerUserId]
          )
        : await client.query<SelectedRun>(
            `SELECT r.id, r.source_path, f.project_id
             FROM public.ingestion_runs r
             LEFT JOIN public.research_folders f ON f.id = r.folder_id AND f.owner_user_id = r.owner_user_id
             WHERE r.owner_user_id = $1 AND r.trashed_at IS NOT NULL AND r.id = ANY($2::uuid[])
             FOR UPDATE OF r`,
            [ownerUserId, runIds]
          );
    const rows = selected.rows;
    if (rows.length === 0) return { deletedRunIds: [], orphanedObjects: [] };

    const ids = rows.map((row) => row.id);
    // Decimal strings: the ids are too large for a JavaScript number.
    const derivedPaperIds = ids.map((id) => paperIdFromRunId(id)).filter(Boolean);

    // A run's paper is found three ways: its payload's paper_id, the content
    // row that names the run, and the id derived from the run. "Make a copy"
    // copies the payload, so a copy and its original share one paper; a paper
    // is deleted only when no run that stays behind still refers to it.
    const doomedPapers = await client.query<{ paper_id: string }>(
      `WITH doomed AS (
         SELECT id, input_payload FROM public.ingestion_runs WHERE owner_user_id = $1 AND id = ANY($2::uuid[])
       ),
       candidates AS (
         SELECT (input_payload->>'paper_id')::bigint AS paper_id
           FROM doomed WHERE (input_payload->>'paper_id') ~ '^[0-9]+$'
         UNION
         SELECT paper_id FROM public.paper_content WHERE owner_user_id = $1 AND ingestion_run_id = ANY($2::uuid[])
         UNION
         SELECT unnest($3::bigint[])
       )
       SELECT c.paper_id::text AS paper_id
       FROM candidates c
       JOIN public.papers p ON p.id = c.paper_id AND p.owner_user_id = $1
       WHERE NOT EXISTS (
         SELECT 1 FROM public.ingestion_runs r
         WHERE r.owner_user_id = $1 AND NOT (r.id = ANY($2::uuid[]))
           AND r.input_payload->>'paper_id' = c.paper_id::text
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.paper_content pc
         WHERE pc.paper_id = c.paper_id AND pc.ingestion_run_id IS NOT NULL AND NOT (pc.ingestion_run_id = ANY($2::uuid[]))
       )`,
      [ownerUserId, ids, derivedPaperIds]
    );
    const paperIds = doomedPapers.rows.map((row) => row.paper_id);

    if (paperIds.length) {
      await client.query(
        `DELETE FROM public.papers WHERE owner_user_id = $1 AND id = ANY($2::bigint[])`,
        [ownerUserId, paperIds]
      );
    }
    // A shared paper's content stays for the run that keeps it; it only stops
    // naming the run that is going.
    await client.query(
      `UPDATE public.paper_content SET ingestion_run_id = NULL
       WHERE owner_user_id = $1 AND ingestion_run_id = ANY($2::uuid[])`,
      [ownerUserId, ids]
    );
    await client.query(
      `UPDATE public.ingestion_runs SET copied_from_run_id = NULL
       WHERE owner_user_id = $1 AND copied_from_run_id = ANY($2::uuid[])`,
      [ownerUserId, ids]
    );
    await client.query(
      `DELETE FROM public.file_fingerprints WHERE owner_user_id = $1 AND latest_run_id = ANY($2::uuid[])`,
      [ownerUserId, ids]
    );
    await client.query(
      `DELETE FROM public.ingestion_runs WHERE owner_user_id = $1 AND id = ANY($2::uuid[])`,
      [ownerUserId, ids]
    );

    const projects = [...new Set(rows.map((row) => row.project_id).filter((id): id is string => Boolean(id)))];
    for (const projectId of projects) {
      await client.query(
        `DELETE FROM public.workspace_analytics_cache
         WHERE owner_user_id = $1 AND scope_type = 'project' AND scope_key = $2`,
        [ownerUserId, projectId]
      );
      await markProjectSemanticMapsStale(client, ownerUserId, projectId);
    }

    const paths = [...new Set(rows.map((row) => String(row.source_path ?? "").trim()).filter(Boolean))];
    const orphanedObjects: string[] = [];
    for (const path of paths) {
      const stillUsed = await client.query(
        `SELECT 1 FROM public.ingestion_runs WHERE owner_user_id = $1 AND source_path = $2 LIMIT 1`,
        [ownerUserId, path]
      );
      if (stillUsed.rowCount === 0 && path.startsWith("gs://")) orphanedObjects.push(path);
    }

    return { deletedRunIds: ids, orphanedObjects };
  });
}
