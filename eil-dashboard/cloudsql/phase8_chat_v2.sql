-- Agentic Repository Chat V2: durable digests, hybrid retrieval, and report jobs.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION public.papertrend_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;

CREATE TABLE IF NOT EXISTS public.paper_retrieval_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  digest_markdown TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  digest_version TEXT NOT NULL DEFAULT 'repository-digest-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, digest_version)
);

CREATE TABLE IF NOT EXISTS public.paper_retrieval_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  section TEXT NOT NULL,
  chunk_index INT NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  token_count INT NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  embedding_model TEXT,
  embedding_version TEXT,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, section, chunk_index, content_hash)
);

CREATE TABLE IF NOT EXISTS public.repository_chat_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  thread_id UUID REFERENCES public.workspace_threads(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  execution_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','canceled')),
  progress_current INT NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total INT NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  result_text TEXT,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  charts JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retrieval_documents_owner_scope
  ON public.paper_retrieval_documents(owner_user_id, project_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_owner_scope
  ON public.paper_retrieval_chunks(owner_user_id, project_id, folder_id, paper_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_fts
  ON public.paper_retrieval_chunks USING GIN (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_embedding
  ON public.paper_retrieval_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repository_chat_jobs_owner_status
  ON public.repository_chat_jobs(owner_user_id, status, updated_at DESC);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'paper_retrieval_documents',
    'paper_retrieval_chunks',
    'repository_chat_jobs'
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
