CREATE TABLE IF NOT EXISTS paper_category_definitions (
  id                    BIGSERIAL PRIMARY KEY,
  paper_id              BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id             UUID REFERENCES research_folders(id) ON DELETE SET NULL,
  taxonomy_name         TEXT NOT NULL DEFAULT 'Project categories',
  taxonomy_definition   TEXT,
  domain                TEXT,
  domain_definition     TEXT,
  category_key          TEXT NOT NULL,
  category_label        TEXT NOT NULL,
  category_description  TEXT,
  position              INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, category_key)
);

CREATE TABLE IF NOT EXISTS paper_category_assignments (
  id                    BIGSERIAL PRIMARY KEY,
  paper_id              BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id             UUID REFERENCES research_folders(id) ON DELETE SET NULL,
  taxonomy_name         TEXT NOT NULL DEFAULT 'Project categories',
  category_key          TEXT NOT NULL,
  category_label        TEXT NOT NULL,
  assignment_type       TEXT NOT NULL CHECK (assignment_type IN ('single', 'multi')),
  is_other              BOOLEAN NOT NULL DEFAULT false,
  rationale             TEXT,
  position              INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_user_id, paper_id, assignment_type, category_key)
);

CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_owner_user_id
  ON paper_category_definitions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_folder_id
  ON paper_category_definitions(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_category
  ON paper_category_definitions(owner_user_id, category_key);

CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_owner_user_id
  ON paper_category_assignments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_folder_id
  ON paper_category_assignments(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_category
  ON paper_category_assignments(owner_user_id, assignment_type, category_key);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_paper_id
  ON paper_category_assignments(paper_id);

ALTER TABLE paper_category_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_category_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read" ON paper_category_definitions;
DROP POLICY IF EXISTS "anon_read" ON paper_category_assignments;

DO $$
BEGIN
  CREATE POLICY "paper_category_definitions_select_own" ON paper_category_definitions
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_category_assignments_select_own" ON paper_category_assignments
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
