-- Phase 8 repository-aware chat support for Cloud SQL.

CREATE TABLE IF NOT EXISTS public.paper_term_index (
  paper_id BIGINT PRIMARY KEY REFERENCES public.papers(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  total_words INT NOT NULL DEFAULT 0 CHECK (total_words >= 0),
  term_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_term_index_owner_run
  ON public.paper_term_index(owner_user_id, ingestion_run_id);

UPDATE public.research_folders AS inbox
SET name = 'Repository', updated_at = now()
WHERE lower(inbox.name) = 'inbox'
  AND NOT EXISTS (
    SELECT 1
    FROM public.research_folders AS repository
    WHERE repository.owner_user_id = inbox.owner_user_id
      AND repository.project_id IS NOT DISTINCT FROM inbox.project_id
      AND lower(repository.name) = 'repository'
  );
