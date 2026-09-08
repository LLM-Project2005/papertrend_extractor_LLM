-- Repository Semantic Map: document embeddings, versioned projections, and explainable edges.
-- Safe to run multiple times against Cloud SQL PostgreSQL.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.paper_semantic_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  representation_version TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INT NOT NULL CHECK (embedding_dimensions > 0),
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, representation_version, embedding_model, content_hash)
);

CREATE TABLE IF NOT EXISTS public.repository_semantic_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'canceled')),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  representation_version TEXT NOT NULL,
  projection_algorithm TEXT,
  projection_version TEXT,
  projection_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  random_seed INT NOT NULL DEFAULT 42,
  paper_count INT NOT NULL DEFAULT 0 CHECK (paper_count >= 0),
  quality_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  clusters JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress_stage TEXT NOT NULL DEFAULT 'queued',
  progress_current INT NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total INT NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.repository_semantic_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES public.repository_semantic_maps(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  cluster_id INT,
  title TEXT NOT NULL,
  year TEXT,
  folder_name TEXT,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (map_id, paper_id)
);

CREATE TABLE IF NOT EXISTS public.repository_semantic_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES public.repository_semantic_maps(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  source_paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  target_paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  cosine_similarity DOUBLE PRECISION NOT NULL CHECK (cosine_similarity >= -1 AND cosine_similarity <= 1),
  edge_rank INT NOT NULL DEFAULT 1 CHECK (edge_rank > 0),
  shared_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_paper_id < target_paper_id),
  UNIQUE (map_id, source_paper_id, target_paper_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_semantic_embeddings_owner_project
  ON public.paper_semantic_embeddings(owner_user_id, project_id, paper_id);
CREATE INDEX IF NOT EXISTS idx_repository_semantic_maps_owner_project
  ON public.repository_semantic_maps(owner_user_id, project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repository_semantic_maps_active_source
  ON public.repository_semantic_maps(owner_user_id, project_id, source_hash)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_repository_semantic_points_owner_map
  ON public.repository_semantic_points(owner_user_id, map_id);
CREATE INDEX IF NOT EXISTS idx_repository_semantic_edges_owner_map
  ON public.repository_semantic_edges(owner_user_id, map_id);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'paper_semantic_embeddings',
    'repository_semantic_maps',
    'repository_semantic_points',
    'repository_semantic_edges'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS papertrend_owner_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY papertrend_owner_access ON public.%I FOR ALL USING (owner_user_id = public.papertrend_current_user_id()) WITH CHECK (owner_user_id = public.papertrend_current_user_id())',
      table_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.paper_semantic_embeddings,
           public.repository_semantic_maps,
           public.repository_semantic_points,
           public.repository_semantic_edges
  TO papertrend_app;

COMMIT;
