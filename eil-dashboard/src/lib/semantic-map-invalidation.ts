import type { PoolClient } from "pg";

/**
 * Preserve existing map revisions while forcing their stored source hash to
 * differ from the repository's current source hash. The semantic-map schema
 * requires every source hash to remain exactly 64 characters.
 */
export async function markProjectSemanticMapsStale(
  client: PoolClient,
  ownerUserId: string,
  projectId: string
): Promise<void> {
  await client.query(
    `UPDATE public.repository_semantic_maps
     SET source_hash = md5(source_hash || ':stale:' || gen_random_uuid()::text)
                       || md5(source_hash || ':stale-2:' || gen_random_uuid()::text),
         updated_at = now()
     WHERE owner_user_id = $1
       AND project_id = $2
       AND status IN ('queued', 'processing', 'succeeded')`,
    [ownerUserId, projectId]
  );
}
