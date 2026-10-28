-- The paper table (docs/42): one row per study in a repository, one column per
-- thing the reader asked for, and each cell with the paper's own sentence.
--
-- A table belongs to one person and one repository. Its columns and cells are
-- JSON: the columns are the reader's list ({id, name, instruction, kind}), and
-- the cells are keyed "<paper id>:<column id>" so a fill can merge each batch
-- of papers it reads with one statement (cells || new cells). The rows are not
-- stored: they are the repository's papers when the table is opened, so a
-- paper added later appears with empty cells and a paper removed disappears.
--
-- Additive: no existing table or row is changed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.paper_tables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID NOT NULL,
  project_id     UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  columns        JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(columns) = 'array'),
  cells          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(cells) = 'object'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_tables_owner_project
  ON public.paper_tables(owner_user_id, project_id, updated_at DESC);

ALTER TABLE public.paper_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS papertrend_owner_access ON public.paper_tables;
CREATE POLICY papertrend_owner_access ON public.paper_tables
  FOR ALL USING (owner_user_id = public.papertrend_current_user_id())
  WITH CHECK (owner_user_id = public.papertrend_current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.paper_tables TO papertrend_app;

INSERT INTO public.schema_migrations (name) VALUES ('20261028_paper_tables.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
