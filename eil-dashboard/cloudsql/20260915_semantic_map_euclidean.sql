-- Semantic Map V2: preserve Euclidean relationship distance alongside the
-- legacy cosine score so old map revisions remain readable during rollout.

BEGIN;

ALTER TABLE public.repository_semantic_edges
  ADD COLUMN IF NOT EXISTS euclidean_distance DOUBLE PRECISION;

UPDATE public.repository_semantic_edges
SET euclidean_distance = sqrt(GREATEST(0, 2 - (2 * cosine_similarity)))
WHERE euclidean_distance IS NULL;

ALTER TABLE public.repository_semantic_edges
  DROP CONSTRAINT IF EXISTS repository_semantic_edges_euclidean_distance_check;

ALTER TABLE public.repository_semantic_edges
  ADD CONSTRAINT repository_semantic_edges_euclidean_distance_check
  CHECK (euclidean_distance IS NULL OR euclidean_distance >= 0);

CREATE INDEX IF NOT EXISTS idx_repository_semantic_edges_map_distance
  ON public.repository_semantic_edges(owner_user_id, map_id, euclidean_distance);

COMMIT;
