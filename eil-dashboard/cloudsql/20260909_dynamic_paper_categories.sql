-- Dynamic project category storage for the authoritative Cloud SQL database.
-- Additive and safe to run more than once.
-- Revision 2: does not alter or reference functions owned by another DB role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.paper_category_definitions (
  id                    BIGSERIAL PRIMARY KEY,
  paper_id              BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  owner_user_id         UUID,
  folder_id             UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  taxonomy_name         TEXT NOT NULL DEFAULT 'Project categories',
  taxonomy_definition   TEXT,
  domain                TEXT,
  domain_definition     TEXT,
  category_key          TEXT NOT NULL,
  category_label        TEXT NOT NULL,
  category_description  TEXT,
  position              INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, category_key)
);

CREATE TABLE IF NOT EXISTS public.paper_category_assignments (
  id                    BIGSERIAL PRIMARY KEY,
  paper_id              BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  owner_user_id         UUID,
  folder_id             UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  taxonomy_name         TEXT NOT NULL DEFAULT 'Project categories',
  category_key          TEXT NOT NULL,
  category_label        TEXT NOT NULL,
  assignment_type       TEXT NOT NULL CHECK (assignment_type IN ('single', 'multi')),
  is_other              BOOLEAN NOT NULL DEFAULT false,
  rationale             TEXT,
  position              INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, assignment_type, category_key)
);

-- Complete partially applied installations without changing existing data.
ALTER TABLE public.paper_category_definitions
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS taxonomy_name TEXT NOT NULL DEFAULT 'Project categories',
  ADD COLUMN IF NOT EXISTS taxonomy_definition TEXT,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS domain_definition TEXT,
  ADD COLUMN IF NOT EXISTS category_description TEXT,
  ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 1;

ALTER TABLE public.paper_category_assignments
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS taxonomy_name TEXT NOT NULL DEFAULT 'Project categories',
  ADD COLUMN IF NOT EXISTS category_label TEXT,
  ADD COLUMN IF NOT EXISTS is_other BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rationale TEXT,
  ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 1;

DO $$
BEGIN
  ALTER TABLE public.paper_category_definitions
    ADD CONSTRAINT paper_category_definitions_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES public.research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.paper_category_assignments
    ADD CONSTRAINT paper_category_assignments_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES public.research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_owner_user_id
  ON public.paper_category_definitions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_folder_id
  ON public.paper_category_definitions(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_category
  ON public.paper_category_definitions(owner_user_id, category_key);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_owner_user_id
  ON public.paper_category_assignments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_folder_id
  ON public.paper_category_assignments(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_category
  ON public.paper_category_assignments(owner_user_id, assignment_type, category_key);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_paper_id
  ON public.paper_category_assignments(paper_id);

ALTER TABLE public.paper_category_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_category_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS papertrend_owner_access ON public.paper_category_definitions;
CREATE POLICY papertrend_owner_access ON public.paper_category_definitions
  FOR ALL
  USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID)
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID);

ALTER TABLE public.paper_category_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_category_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS papertrend_owner_access ON public.paper_category_assignments;
CREATE POLICY papertrend_owner_access ON public.paper_category_assignments
  FOR ALL
  USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID)
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID);

-- Tables created by the migration administrator still need to be available to
-- the restricted application role. Row-level security remains authoritative.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.paper_category_definitions, public.paper_category_assignments
  TO papertrend_app;
GRANT USAGE, SELECT
  ON SEQUENCE public.paper_category_definitions_id_seq,
              public.paper_category_assignments_id_seq
  TO papertrend_app;

COMMIT;
