-- ==================================================================
-- Papertrend - Cloud SQL PostgreSQL Schema
-- ==================================================================
-- Run this against the Cloud SQL PostgreSQL database.
-- This schema is additive-only so preview work can share the same
-- Cloud SQL database without breaking the current production contract.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- The search index and the semantic map store embeddings (folded in below).
CREATE EXTENSION IF NOT EXISTS vector;

-- This Cloud SQL schema intentionally omits Supabase RLS policies, auth.users
-- foreign keys, storage bucket creation, and auth triggers. Authorization must
-- be enforced by the application service layer until Google-native auth is added.

-- ------------------------------------------------------------------
-- 1. Papers
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS papers (
  id          BIGINT PRIMARY KEY,
  owner_user_id UUID,
  folder_id   UUID,
  year        TEXT NOT NULL,
  year_confidence NUMERIC,
  year_source TEXT,
  year_evidence TEXT,
  year_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 1a. Organizations and projects
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'personal'
                CHECK (type IN ('personal', 'academic', 'research_lab', 'department', 'company', 'other')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS workspace_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES workspace_organizations(id) ON DELETE CASCADE,
  owner_user_id   UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  analysis_profile JSONB,
  analysis_profile_version INT,
  analysis_profile_hash TEXT,
  analysis_profile_updated_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- ------------------------------------------------------------------
-- 1b. Research folders
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS research_folders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  organization_id UUID REFERENCES workspace_organizations(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES workspace_projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_user_id, project_id, name)
);

-- ------------------------------------------------------------------
-- 1c. User Profiles
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id                 UUID PRIMARY KEY,
  email              TEXT UNIQUE,
  full_name          TEXT,
  avatar_url         TEXT,
  role               TEXT NOT NULL DEFAULT 'member'
                     CHECK (role IN ('member', 'admin')),
  workspace_profile  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 1e. Provider-neutral identity mappings
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_identity_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('supabase', 'firebase')),
  external_subject  TEXT NOT NULL,
  email             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_subject),
  UNIQUE (provider, owner_user_id)
);

CREATE OR REPLACE FUNCTION public.prevent_auth_identity_key_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.external_subject IS DISTINCT FROM NEW.external_subject THEN
    RAISE EXCEPTION 'auth identity mapping keys are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_identity_mapping_key_guard
  ON public.auth_identity_mappings;
CREATE TRIGGER auth_identity_mapping_key_guard
BEFORE UPDATE ON public.auth_identity_mappings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_auth_identity_key_change();

-- ------------------------------------------------------------------
-- 1d. Google Drive Connections
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_drive_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  provider          TEXT NOT NULL DEFAULT 'google_drive'
                    CHECK (provider = 'google_drive'),
  external_email    TEXT,
  external_user_id  TEXT,
  access_token      TEXT,
  refresh_token     TEXT,
  token_type        TEXT,
  scope             TEXT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- ------------------------------------------------------------------
-- 2. Paper Keywords / Trends
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_keywords (
  id                 BIGSERIAL PRIMARY KEY,
  paper_id           BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id      UUID,
  folder_id          UUID,
  topic              TEXT NOT NULL,
  keyword            TEXT NOT NULL,
  keyword_frequency  INT DEFAULT 1,
  evidence           TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 3. Track Classification - Single Choice
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_tracks_single (
  paper_id    BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id UUID,
  folder_id   UUID,
  el          SMALLINT DEFAULT 0 CHECK (el IN (0, 1)),
  eli         SMALLINT DEFAULT 0 CHECK (eli IN (0, 1)),
  lae         SMALLINT DEFAULT 0 CHECK (lae IN (0, 1)),
  other       SMALLINT DEFAULT 0 CHECK (other IN (0, 1)),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 4. Track Classification - Multi Label
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_tracks_multi (
  paper_id    BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id UUID,
  folder_id   UUID,
  el          SMALLINT DEFAULT 0 CHECK (el IN (0, 1)),
  eli         SMALLINT DEFAULT 0 CHECK (eli IN (0, 1)),
  lae         SMALLINT DEFAULT 0 CHECK (lae IN (0, 1)),
  other       SMALLINT DEFAULT 0 CHECK (other IN (0, 1)),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 5. Ingestion Runs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID,
  folder_id        UUID,
  folder_analysis_job_id UUID,
  source_type      TEXT NOT NULL CHECK (source_type IN ('batch', 'upload')),
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  source_filename  TEXT,
  display_name     TEXT,
  source_path      TEXT,
  source_extension TEXT,
  mime_type        TEXT,
  file_size_bytes  BIGINT,
  provider         TEXT,
  model            TEXT,
  is_favorite      BOOLEAN NOT NULL DEFAULT false,
  copied_from_run_id UUID REFERENCES ingestion_runs(id),
  trashed_at       TIMESTAMPTZ,
  input_payload    JSONB DEFAULT '{}'::jsonb,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- 5b. Folder analysis jobs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS folder_analysis_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      UUID NOT NULL,
  folder_id          UUID NOT NULL REFERENCES research_folders(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  total_runs         INT NOT NULL DEFAULT 0,
  queued_runs        INT NOT NULL DEFAULT 0,
  processing_runs    INT NOT NULL DEFAULT 0,
  succeeded_runs     INT NOT NULL DEFAULT 0,
  failed_runs        INT NOT NULL DEFAULT 0,
  progress_stage     TEXT,
  progress_message   TEXT,
  progress_detail    TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- 6. Paper Content - Canonical section store
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_content (
  paper_id          BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id     UUID,
  folder_id         UUID,
  raw_text          TEXT,
  abstract          TEXT,
  abstract_claims   TEXT,
  body              TEXT,
  methods           TEXT,
  results           TEXT,
  conclusion        TEXT,
  source_filename   TEXT,
  source_path       TEXT,
  ingestion_run_id  UUID REFERENCES ingestion_runs(id),
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE paper_content
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS raw_text TEXT,
  ADD COLUMN IF NOT EXISTS abstract TEXT,
  ADD COLUMN IF NOT EXISTS abstract_claims TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS methods TEXT,
  ADD COLUMN IF NOT EXISTS results TEXT,
  ADD COLUMN IF NOT EXISTS conclusion TEXT,
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS source_path TEXT,
  ADD COLUMN IF NOT EXISTS ingestion_run_id UUID REFERENCES ingestion_runs(id);

CREATE TABLE IF NOT EXISTS paper_term_index (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  folder_id UUID REFERENCES research_folders(id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  total_words INT NOT NULL DEFAULT 0 CHECK (total_words >= 0),
  term_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_term_index_owner_run
  ON paper_term_index(owner_user_id, ingestion_run_id);

-- ------------------------------------------------------------------
-- 7. Canonical keyword concepts
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_keyword_concepts (
  id                BIGSERIAL PRIMARY KEY,
  paper_id          BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id     UUID,
  folder_id         UUID,
  concept_label     TEXT NOT NULL,
  matched_terms     JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_keywords  JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_frequency   INT NOT NULL DEFAULT 1,
  first_section     TEXT,
  first_span_start  INT NOT NULL DEFAULT 0,
  first_span_end    INT NOT NULL DEFAULT 0,
  first_evidence    TEXT,
  evidence_snippets JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 5c. Trash helpers are stored directly on ingestion_runs via trashed_at
-- ------------------------------------------------------------------

-- ------------------------------------------------------------------
-- 8. Higher-level analytical facets
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_analysis_facets (
  id          BIGSERIAL PRIMARY KEY,
  paper_id    BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id UUID,
  folder_id   UUID,
  facet_type  TEXT NOT NULL
              CHECK (facet_type IN ('objective_verb', 'contribution_type')),
  label       TEXT NOT NULL,
  evidence    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 8b. Author-provided keywords
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_author_keywords (
  id                 BIGSERIAL PRIMARY KEY,
  paper_id           BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id      UUID,
  folder_id          UUID,
  keyword            TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  evidence           TEXT,
  source_section     TEXT,
  position           INT NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 8c. Research typology classification
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_research_typologies (
  paper_id              BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id         UUID,
  folder_id             UUID,
  primary_group_number  SMALLINT NOT NULL CHECK (primary_group_number BETWEEN 1 AND 4),
  primary_group_name    TEXT NOT NULL,
  secondary_group_number SMALLINT CHECK (secondary_group_number BETWEEN 1 AND 4),
  secondary_group_name  TEXT,
  stated_purpose        TEXT,
  primary_contribution  TEXT,
  group_match           TEXT,
  boundary_rule         TEXT,
  verdict               TEXT,
  classifier_source     TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 8d. Dynamic paper categories
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_category_definitions (
  id                    BIGSERIAL PRIMARY KEY,
  paper_id              BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id         UUID,
  folder_id             UUID,
  project_id            UUID REFERENCES workspace_projects(id) ON DELETE CASCADE,
  profile_hash          TEXT,
  profile_version       INT,
  classification_revision_id UUID,
  classifier_model      TEXT,
  classified_at         TIMESTAMPTZ DEFAULT now(),
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
  owner_user_id         UUID,
  folder_id             UUID,
  project_id            UUID REFERENCES workspace_projects(id) ON DELETE CASCADE,
  profile_hash          TEXT,
  profile_version       INT,
  classification_revision_id UUID,
  classifier_model      TEXT,
  classified_at         TIMESTAMPTZ DEFAULT now(),
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

CREATE TABLE IF NOT EXISTS project_reclassification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
  target_profile JSONB NOT NULL,
  target_profile_hash TEXT NOT NULL,
  target_profile_version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','canceled')),
  total_items INT NOT NULL DEFAULT 0,
  processed_items INT NOT NULL DEFAULT 0,
  failed_items INT NOT NULL DEFAULT 0,
  progress_stage TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_reclassification_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES project_reclassification_jobs(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
  paper_id BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  folder_id UUID REFERENCES research_folders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','canceled')),
  result_payload JSONB,
  classifier_model TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (job_id,paper_id)
);

-- ------------------------------------------------------------------
-- 9. Workspace threads and research sessions
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  folder_id     UUID REFERENCES research_folders(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL DEFAULT 'normal'
                CHECK (mode IN ('normal', 'deep_research')),
  title         TEXT NOT NULL,
  summary       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES workspace_threads(id) ON DELETE CASCADE,
  owner_user_id   UUID NOT NULL,
  folder_id       UUID REFERENCES research_folders(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  message_kind    TEXT NOT NULL DEFAULT 'chat'
                  CHECK (message_kind IN ('chat', 'deep_research_plan', 'deep_research_report', 'status')),
  content         TEXT NOT NULL DEFAULT '',
  citations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deep_research_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id             UUID NOT NULL REFERENCES workspace_threads(id) ON DELETE CASCADE,
  owner_user_id         UUID NOT NULL,
  folder_id             UUID REFERENCES research_folders(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'queued', 'waiting_on_analysis', 'processing', 'completed', 'failed', 'canceled')),
  prompt                TEXT NOT NULL,
  plan_summary          TEXT,
  final_report          TEXT,
  requires_analysis     BOOLEAN NOT NULL DEFAULT false,
  pending_run_count     INT NOT NULL DEFAULT 0,
  last_error            TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS deep_research_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES deep_research_sessions(id) ON DELETE CASCADE,
  owner_user_id   UUID NOT NULL,
  position        INT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  tool_name       TEXT,
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'processing', 'completed', 'failed', 'waiting')),
  input_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, position)
);

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS year_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS year_source TEXT,
  ADD COLUMN IF NOT EXISTS year_evidence TEXT,
  ADD COLUMN IF NOT EXISTS year_candidates JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE paper_keywords
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_tracks_single
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_tracks_multi
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE ingestion_runs
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS folder_analysis_job_id UUID,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS source_extension TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS copied_from_run_id UUID REFERENCES ingestion_runs(id),
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;

ALTER TABLE research_folders
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES workspace_organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES workspace_projects(id) ON DELETE CASCADE;

ALTER TABLE paper_keyword_concepts
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_analysis_facets
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_author_keywords
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS normalized_keyword TEXT,
  ADD COLUMN IF NOT EXISTS evidence TEXT,
  ADD COLUMN IF NOT EXISTS source_section TEXT,
  ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 1;

ALTER TABLE paper_research_typologies
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS secondary_group_number SMALLINT,
  ADD COLUMN IF NOT EXISTS secondary_group_name TEXT,
  ADD COLUMN IF NOT EXISTS stated_purpose TEXT,
  ADD COLUMN IF NOT EXISTS primary_contribution TEXT,
  ADD COLUMN IF NOT EXISTS group_match TEXT,
  ADD COLUMN IF NOT EXISTS boundary_rule TEXT,
  ADD COLUMN IF NOT EXISTS verdict TEXT,
  ADD COLUMN IF NOT EXISTS classifier_source TEXT;

ALTER TABLE paper_category_definitions
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS taxonomy_definition TEXT,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS domain_definition TEXT,
  ADD COLUMN IF NOT EXISTS category_description TEXT,
  ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES workspace_projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS profile_hash TEXT,
  ADD COLUMN IF NOT EXISTS profile_version INT,
  ADD COLUMN IF NOT EXISTS classification_revision_id UUID,
  ADD COLUMN IF NOT EXISTS classifier_model TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE paper_category_assignments
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS taxonomy_name TEXT NOT NULL DEFAULT 'Project categories',
  ADD COLUMN IF NOT EXISTS category_label TEXT,
  ADD COLUMN IF NOT EXISTS is_other BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rationale TEXT,
  ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES workspace_projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS profile_hash TEXT,
  ADD COLUMN IF NOT EXISTS profile_version INT,
  ADD COLUMN IF NOT EXISTS classification_revision_id UUID,
  ADD COLUMN IF NOT EXISTS classifier_model TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  ALTER TABLE papers
    ADD CONSTRAINT papers_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_keywords
    ADD CONSTRAINT paper_keywords_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_tracks_single
    ADD CONSTRAINT paper_tracks_single_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_tracks_multi
    ADD CONSTRAINT paper_tracks_multi_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ingestion_runs
    ADD CONSTRAINT ingestion_runs_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ingestion_runs
    ADD CONSTRAINT ingestion_runs_copied_from_run_id_fkey
    FOREIGN KEY (copied_from_run_id) REFERENCES ingestion_runs(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ingestion_runs
    ADD CONSTRAINT ingestion_runs_folder_analysis_job_id_fkey
    FOREIGN KEY (folder_analysis_job_id) REFERENCES folder_analysis_jobs(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_content
    ADD CONSTRAINT paper_content_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_keyword_concepts
    ADD CONSTRAINT paper_keyword_concepts_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_analysis_facets
    ADD CONSTRAINT paper_analysis_facets_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_author_keywords
    ADD CONSTRAINT paper_author_keywords_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_research_typologies
    ADD CONSTRAINT paper_research_typologies_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_category_definitions
    ADD CONSTRAINT paper_category_definitions_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE paper_category_assignments
    ADD CONSTRAINT paper_category_assignments_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES research_folders(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- ------------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_owner_user_id ON papers(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_papers_folder_id ON papers(folder_id);
CREATE INDEX IF NOT EXISTS idx_workspace_organizations_owner_user_id ON workspace_organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_projects_organization_id ON workspace_projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_workspace_projects_owner_user_id ON workspace_projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_research_folders_owner_user_id ON research_folders(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_research_folders_organization_id ON research_folders(organization_id);
CREATE INDEX IF NOT EXISTS idx_research_folders_project_id ON research_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_research_folders_name ON research_folders(owner_user_id, project_id, name);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_auth_identity_mappings_owner ON auth_identity_mappings(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_auth_identity_mappings_provider_subject ON auth_identity_mappings(provider, external_subject);
CREATE INDEX IF NOT EXISTS idx_google_drive_connections_user_id ON google_drive_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_paper_id ON paper_keywords(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_owner_user_id ON paper_keywords(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_folder_id ON paper_keywords(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_keyword ON paper_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_topic ON paper_keywords(topic);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_owner_user_id ON ingestion_runs(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_folder_id ON ingestion_runs(folder_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_folder_analysis_job_id ON ingestion_runs(folder_analysis_job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_display_name ON ingestion_runs(display_name);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_is_favorite ON ingestion_runs(is_favorite);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_trashed_at ON ingestion_runs(trashed_at);
CREATE INDEX IF NOT EXISTS idx_folder_analysis_jobs_owner_user_id ON folder_analysis_jobs(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_folder_analysis_jobs_folder_id ON folder_analysis_jobs(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_content_run_id ON paper_content(ingestion_run_id);
CREATE INDEX IF NOT EXISTS idx_paper_content_owner_user_id ON paper_content(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_content_folder_id ON paper_content(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_keyword_concepts_paper_id ON paper_keyword_concepts(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_keyword_concepts_owner_user_id ON paper_keyword_concepts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_keyword_concepts_folder_id ON paper_keyword_concepts(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_keyword_concepts_label ON paper_keyword_concepts(concept_label);
CREATE INDEX IF NOT EXISTS idx_paper_analysis_facets_paper_id ON paper_analysis_facets(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_analysis_facets_owner_user_id ON paper_analysis_facets(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_analysis_facets_folder_id ON paper_analysis_facets(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_analysis_facets_type ON paper_analysis_facets(facet_type);
CREATE INDEX IF NOT EXISTS idx_paper_author_keywords_paper_id ON paper_author_keywords(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_author_keywords_owner_user_id ON paper_author_keywords(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_author_keywords_folder_id ON paper_author_keywords(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_author_keywords_keyword ON paper_author_keywords(normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_paper_research_typologies_owner_user_id ON paper_research_typologies(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_research_typologies_folder_id ON paper_research_typologies(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_research_typologies_primary ON paper_research_typologies(primary_group_number);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_owner_user_id ON paper_category_definitions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_folder_id ON paper_category_definitions(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_category ON paper_category_definitions(owner_user_id, category_key);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_owner_user_id ON paper_category_assignments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_folder_id ON paper_category_assignments(folder_id);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_category ON paper_category_assignments(owner_user_id, assignment_type, category_key);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_paper_id ON paper_category_assignments(paper_id);
CREATE INDEX IF NOT EXISTS idx_workspace_threads_owner_user_id ON workspace_threads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_threads_folder_id ON workspace_threads(folder_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_thread_id ON workspace_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_owner_user_id ON workspace_messages(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_thread_id ON deep_research_sessions(thread_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_owner_user_id ON deep_research_sessions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_folder_id ON deep_research_sessions(folder_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_status ON deep_research_sessions(status);
CREATE INDEX IF NOT EXISTS idx_deep_research_steps_session_id ON deep_research_steps(session_id);

-- ------------------------------------------------------------------
-- 10. Security, usage, cache, and fingerprint helpers
-- ------------------------------------------------------------------
-- Papertrend beta hardening: rate limits, AI usage, cache tables, and hot-path indexes.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS security_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  ip_hash TEXT,
  owner_user_id UUID,
  action TEXT NOT NULL DEFAULT 'attempt',
  allowed BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invite codes (cloudsql/20260929_invite_codes.sql): a new account needs one
-- while the site is closed. Only each code's SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS invite_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash     TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  label         TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  bound_email   TEXT CHECK (bound_email IS NULL OR (bound_email = lower(bound_email) AND char_length(bound_email) <= 254)),
  max_uses      INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
  use_count     INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  created_by    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invite_code_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code_id  UUID NOT NULL REFERENCES invite_codes(id),
  owner_user_id   UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  email           TEXT,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_code_redemptions_code
  ON invite_code_redemptions(invite_code_id);

-- Access requests (cloudsql/20261002_access_requests.sql): someone without an
-- invite code asks for one; deleted after 180 days.
CREATE TABLE IF NOT EXISTS access_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email           TEXT NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  affiliation     TEXT NOT NULL CHECK (char_length(affiliation) BETWEEN 1 AND 200),
  intended_use    TEXT NOT NULL CHECK (char_length(intended_use) BETWEEN 1 AND 1000),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'declined')),
  invite_code_id  UUID, -- an invite_codes id; not a foreign key (see the migration)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_requests_open_email
  ON access_requests(email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_requests_created
  ON access_requests(created_at DESC);

-- The migration ledger (cloudsql/20261002_schema_migrations.sql): every
-- migration records its own name here before it commits.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY CHECK (name ~ '^[0-9a-z_]+\.sql$'),
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user,
  note        TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 200)
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  usage_kind TEXT NOT NULL CHECK (
    usage_kind IN ('chat_message', 'web_search', 'chart', 'deep_research')
  ),
  units INT NOT NULL DEFAULT 1 CHECK (units > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_analytics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'project', 'folder', 'custom')),
  scope_key TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS file_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT,
  source_filename TEXT,
  latest_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_security_rate_limit_lookup
  ON security_rate_limit_events(bucket, subject_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_owner_kind_created
  ON ai_usage_events(owner_user_id, usage_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_analytics_cache_owner_scope
  ON workspace_analytics_cache(owner_user_id, scope_type, scope_key);

CREATE INDEX IF NOT EXISTS idx_file_fingerprints_owner_sha
  ON file_fingerprints(owner_user_id, sha256);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_owner_status_updated
  ON ingestion_runs(owner_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_owner_folder_status_updated
  ON ingestion_runs(owner_user_id, folder_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_job_status
  ON ingestion_runs(folder_analysis_job_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_threads_owner_updated
  ON workspace_threads(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_messages_thread_created
  ON workspace_messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_paper_content_owner_run
  ON paper_content(owner_user_id, ingestion_run_id);

CREATE INDEX IF NOT EXISTS idx_paper_keywords_owner_folder_topic
  ON paper_keywords(owner_user_id, folder_id, topic);

CREATE INDEX IF NOT EXISTS idx_paper_keywords_owner_folder_keyword
  ON paper_keywords(owner_user_id, folder_id, keyword);

-- ------------------------------------------------------------------
-- VIEWS consumed by the Next.js app
-- ------------------------------------------------------------------
DROP VIEW IF EXISTS trends_flat;
CREATE VIEW trends_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.year_confidence,
  p.year_source,
  p.year_evidence,
  p.year_candidates,
  p.title,
  pk.topic,
  pk.keyword,
  pk.keyword_frequency,
  pk.evidence
FROM papers p
JOIN paper_keywords pk ON pk.paper_id = p.id;

DROP VIEW IF EXISTS tracks_single_flat;
CREATE VIEW tracks_single_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.year_confidence,
  p.year_source,
  p.year_evidence,
  p.year_candidates,
  p.title,
  ts.el,
  ts.eli,
  ts.lae,
  ts.other
FROM papers p
JOIN paper_tracks_single ts ON ts.paper_id = p.id;

DROP VIEW IF EXISTS tracks_multi_flat;
CREATE VIEW tracks_multi_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.year_confidence,
  p.year_source,
  p.year_evidence,
  p.year_candidates,
  p.title,
  tm.el,
  tm.eli,
  tm.lae,
  tm.other
FROM papers p
JOIN paper_tracks_multi tm ON tm.paper_id = p.id;

DROP VIEW IF EXISTS papers_full;
CREATE VIEW papers_full AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.year_confidence,
  p.year_source,
  p.year_evidence,
  p.year_candidates,
  p.title,
  pc.abstract,
  COALESCE(pc.abstract_claims, pc.abstract) AS abstract_claims,
  pc.methods,
  pc.results,
  pc.body,
  pc.conclusion,
  pc.raw_text,
  pc.source_filename,
  pc.source_path,
  pc.ingestion_run_id
FROM papers p
LEFT JOIN paper_content pc ON pc.paper_id = p.id;

DROP VIEW IF EXISTS concepts_flat;
CREATE VIEW concepts_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  pkc.concept_label,
  pkc.matched_terms,
  pkc.related_keywords,
  pkc.total_frequency,
  pkc.first_section,
  pkc.first_span_start,
  pkc.first_span_end,
  pkc.first_evidence,
  pkc.evidence_snippets
FROM papers p
JOIN paper_keyword_concepts pkc ON pkc.paper_id = p.id;

DROP VIEW IF EXISTS paper_facets_flat;
CREATE VIEW paper_facets_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  paf.facet_type,
  paf.label,
  paf.evidence
FROM papers p
JOIN paper_analysis_facets paf ON paf.paper_id = p.id;

DROP VIEW IF EXISTS author_keywords_flat;
CREATE VIEW author_keywords_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  pak.keyword,
  pak.normalized_keyword,
  pak.evidence,
  pak.source_section,
  pak.position,
  ts.el,
  ts.eli,
  ts.lae,
  ts.other
FROM papers p
JOIN paper_author_keywords pak ON pak.paper_id = p.id
LEFT JOIN paper_tracks_single ts ON ts.paper_id = p.id;

DROP VIEW IF EXISTS research_typologies_flat;
CREATE VIEW research_typologies_flat AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  prt.primary_group_number,
  prt.primary_group_name,
  prt.secondary_group_number,
  prt.secondary_group_name,
  prt.stated_purpose,
  prt.primary_contribution,
  prt.group_match,
  prt.boundary_rule,
  prt.verdict,
  prt.classifier_source
FROM papers p
JOIN paper_research_typologies prt ON prt.paper_id = p.id;

-- ===========================================================================
-- Folded in from migrations (docs/32, long-term health: one authoritative
-- schema). These files were applied to the live database but never copied
-- here, so this file alone built a database without the search index, the
-- semantic map or the repository profiles. Each part names its file; the
-- BEGIN/COMMIT and GRANT lines are left out (a fresh database has no app role
-- yet). The result was checked against the live database on 2026-10-02, and
-- tests/schema-authority.test.ts keeps it that way (cloudsql/live-structure.json).
-- ===========================================================================

-- ----------------------------------------------------- from phase8_chat_v2.sql

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
  project_id UUID REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
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

-- ----------------------------------------------------- from phase8_knowledge_chat_v3.sql

-- Knowledge Chat V3 supports owner-wide reports that are not tied to one project.
ALTER TABLE public.repository_chat_jobs
  ALTER COLUMN project_id DROP NOT NULL;

-- ----------------------------------------------------- from 20260909_dynamic_paper_categories.sql

-- Dynamic project category storage for the authoritative Cloud SQL database.
-- Additive and safe to run more than once.
-- Revision 2: does not alter or reference functions owned by another DB role.

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

-- ----------------------------------------------------- from 20260909_repository_semantic_map.sql

-- Repository Semantic Map: document embeddings, versioned projections, and explainable edges.
-- Safe to run multiple times against Cloud SQL PostgreSQL.

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
  euclidean_distance DOUBLE PRECISION CHECK (euclidean_distance IS NULL OR euclidean_distance >= 0),
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

-- ----------------------------------------------------- from 20260910_project_analysis_profiles.sql

-- Repository-owned analysis profiles and classification provenance.
-- Additive and safe to run multiple times.

ALTER TABLE public.workspace_projects
  ADD COLUMN IF NOT EXISTS analysis_profile JSONB,
  ADD COLUMN IF NOT EXISTS analysis_profile_version INT,
  ADD COLUMN IF NOT EXISTS analysis_profile_hash TEXT,
  ADD COLUMN IF NOT EXISTS analysis_profile_updated_at TIMESTAMPTZ;

UPDATE public.workspace_projects p
SET analysis_profile = CASE
      WHEN jsonb_array_length(
        CASE WHEN jsonb_typeof(up.workspace_profile->'analysisCategories') = 'array'
          THEN up.workspace_profile->'analysisCategories' ELSE '[]'::jsonb END
      ) > 0
      THEN jsonb_build_object(
        'version', 2,
        'mode', 'custom',
        'displayName', COALESCE(NULLIF(up.workspace_profile->>'categoryTaxonomyName', ''), 'Custom Taxonomy'),
        'domain', COALESCE(NULLIF(up.workspace_profile->>'domain', ''), 'General academic research'),
        'domainDefinition', COALESCE(up.workspace_profile->>'domainDefinition', ''),
        'taxonomyName', COALESCE(NULLIF(up.workspace_profile->>'categoryTaxonomyName', ''), 'Custom Taxonomy'),
        'taxonomyDefinition', COALESCE(up.workspace_profile->>'categoryTaxonomyDefinition', ''),
        'additionalContext', COALESCE(up.workspace_profile->>'analysisContext', ''),
        'classificationEnabled', true,
        'categories', up.workspace_profile->'analysisCategories'
      )
      ELSE jsonb_build_object(
        'version', 2, 'mode', 'general', 'displayName', 'General Research',
        'domain', 'General academic research', 'domainDefinition', '',
        'taxonomyName', 'No category classification', 'taxonomyDefinition', '',
        'additionalContext', '', 'classificationEnabled', false, 'categories', '[]'::jsonb
      )
    END,
    analysis_profile_version = 2,
    analysis_profile_updated_at = COALESCE(p.updated_at, now())
FROM public.user_profiles up
WHERE p.owner_user_id = up.id AND p.analysis_profile IS NULL;

UPDATE public.workspace_projects
SET analysis_profile = jsonb_build_object(
      'version', 2, 'mode', 'general', 'displayName', 'General Research',
      'domain', 'General academic research', 'domainDefinition', '',
      'taxonomyName', 'No category classification', 'taxonomyDefinition', '',
      'additionalContext', '', 'classificationEnabled', false, 'categories', '[]'::jsonb
    ),
    analysis_profile_version = 2,
    analysis_profile_updated_at = COALESCE(updated_at, now())
WHERE analysis_profile IS NULL;

-- The controlled application backfill replaces this temporary database hash
-- with the canonical profile hash before the pilot is enabled.
UPDATE public.workspace_projects
SET analysis_profile_hash = md5(analysis_profile::text)
WHERE analysis_profile_hash IS NULL;

ALTER TABLE public.workspace_projects
  ALTER COLUMN analysis_profile SET NOT NULL,
  ALTER COLUMN analysis_profile_version SET NOT NULL,
  ALTER COLUMN analysis_profile_hash SET NOT NULL,
  ALTER COLUMN analysis_profile_updated_at SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.workspace_projects
    ADD CONSTRAINT workspace_projects_analysis_profile_version_check
    CHECK (analysis_profile_version > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.paper_category_definitions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS profile_hash TEXT,
  ADD COLUMN IF NOT EXISTS profile_version INT,
  ADD COLUMN IF NOT EXISTS classification_revision_id UUID,
  ADD COLUMN IF NOT EXISTS classifier_model TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.paper_category_assignments
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS profile_hash TEXT,
  ADD COLUMN IF NOT EXISTS profile_version INT,
  ADD COLUMN IF NOT EXISTS classification_revision_id UUID,
  ADD COLUMN IF NOT EXISTS classifier_model TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ DEFAULT now();

UPDATE public.paper_category_definitions pcd
SET project_id = rf.project_id,
    classified_at = COALESCE(pcd.classified_at, pcd.created_at)
FROM public.research_folders rf
WHERE pcd.project_id IS NULL AND pcd.folder_id = rf.id;

UPDATE public.paper_category_assignments pca
SET project_id = rf.project_id,
    classified_at = COALESCE(pca.classified_at, pca.created_at)
FROM public.research_folders rf
WHERE pca.project_id IS NULL AND pca.folder_id = rf.id;

UPDATE public.paper_category_definitions pcd
SET profile_hash = COALESCE(
      NULLIF(ir.input_payload #>> '{analysis_profile,profileHash}', ''),
      NULLIF(ir.input_payload #>> '{analysis_profile,profile_hash}', ''),
      'legacy'
    ),
    profile_version = CASE
      WHEN COALESCE(
        NULLIF(ir.input_payload #>> '{analysis_profile,profileVersion}', ''),
        NULLIF(ir.input_payload #>> '{analysis_profile,profile_version}', '')
      ) ~ '^[1-9][0-9]*$'
      THEN COALESCE(
        NULLIF(ir.input_payload #>> '{analysis_profile,profileVersion}', ''),
        NULLIF(ir.input_payload #>> '{analysis_profile,profile_version}', '')
      )::INT
      ELSE 1
    END,
    classifier_model = COALESCE(pcd.classifier_model, ir.model, 'legacy')
FROM public.paper_content pc
JOIN public.ingestion_runs ir ON ir.id = pc.ingestion_run_id
WHERE pcd.paper_id = pc.paper_id AND pcd.owner_user_id = pc.owner_user_id
  AND (pcd.profile_hash IS NULL OR pcd.profile_version IS NULL OR pcd.classifier_model IS NULL);

UPDATE public.paper_category_assignments pca
SET profile_hash = COALESCE(
      NULLIF(ir.input_payload #>> '{analysis_profile,profileHash}', ''),
      NULLIF(ir.input_payload #>> '{analysis_profile,profile_hash}', ''),
      'legacy'
    ),
    profile_version = CASE
      WHEN COALESCE(
        NULLIF(ir.input_payload #>> '{analysis_profile,profileVersion}', ''),
        NULLIF(ir.input_payload #>> '{analysis_profile,profile_version}', '')
      ) ~ '^[1-9][0-9]*$'
      THEN COALESCE(
        NULLIF(ir.input_payload #>> '{analysis_profile,profileVersion}', ''),
        NULLIF(ir.input_payload #>> '{analysis_profile,profile_version}', '')
      )::INT
      ELSE 1
    END,
    classifier_model = COALESCE(pca.classifier_model, ir.model, 'legacy')
FROM public.paper_content pc
JOIN public.ingestion_runs ir ON ir.id = pc.ingestion_run_id
WHERE pca.paper_id = pc.paper_id AND pca.owner_user_id = pc.owner_user_id
  AND (pca.profile_hash IS NULL OR pca.profile_version IS NULL OR pca.classifier_model IS NULL);

UPDATE public.paper_category_definitions
SET profile_hash = COALESCE(profile_hash, 'legacy'),
    profile_version = COALESCE(profile_version, 1),
    classifier_model = COALESCE(classifier_model, 'legacy')
WHERE profile_hash IS NULL OR profile_version IS NULL OR classifier_model IS NULL;

UPDATE public.paper_category_assignments
SET profile_hash = COALESCE(profile_hash, 'legacy'),
    profile_version = COALESCE(profile_version, 1),
    classifier_model = COALESCE(classifier_model, 'legacy')
WHERE profile_hash IS NULL OR profile_version IS NULL OR classifier_model IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_projects_analysis_profile_hash
  ON public.workspace_projects(owner_user_id, analysis_profile_hash);
CREATE INDEX IF NOT EXISTS idx_paper_category_definitions_project_profile
  ON public.paper_category_definitions(owner_user_id, project_id, profile_hash);
CREATE INDEX IF NOT EXISTS idx_paper_category_assignments_project_profile
  ON public.paper_category_assignments(owner_user_id, project_id, profile_hash, assignment_type);

CREATE TABLE IF NOT EXISTS public.project_reclassification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  target_profile JSONB NOT NULL,
  target_profile_hash TEXT NOT NULL,
  target_profile_version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'canceled')),
  total_items INT NOT NULL DEFAULT 0,
  processed_items INT NOT NULL DEFAULT 0,
  failed_items INT NOT NULL DEFAULT 0,
  progress_stage TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.project_reclassification_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.project_reclassification_jobs(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.workspace_projects(id) ON DELETE CASCADE,
  paper_id BIGINT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  folder_id UUID REFERENCES public.research_folders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'canceled')),
  result_payload JSONB,
  classifier_model TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (job_id, paper_id)
);

CREATE INDEX IF NOT EXISTS idx_project_reclassification_jobs_owner_project
  ON public.project_reclassification_jobs(owner_user_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_reclassification_items_owner_job
  ON public.project_reclassification_items(owner_user_id, job_id, status);

ALTER TABLE public.project_reclassification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_reclassification_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS papertrend_owner_access ON public.project_reclassification_jobs;
CREATE POLICY papertrend_owner_access ON public.project_reclassification_jobs
  FOR ALL
  USING (owner_user_id = public.papertrend_current_user_id())
  WITH CHECK (owner_user_id = public.papertrend_current_user_id());

ALTER TABLE public.project_reclassification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_reclassification_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS papertrend_owner_access ON public.project_reclassification_items;
CREATE POLICY papertrend_owner_access ON public.project_reclassification_items
  FOR ALL
  USING (owner_user_id = public.papertrend_current_user_id())
  WITH CHECK (owner_user_id = public.papertrend_current_user_id());

-- ----------------------------------------------------- from 20260915_semantic_map_euclidean.sql

-- Semantic Map V2: preserve Euclidean relationship distance alongside the
-- legacy cosine score so old map revisions remain readable during rollout.

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

-- ----------------------------------------------------- set on the live database
-- outside any migration file; recorded here so a fresh database matches it.

ALTER TABLE paper_category_assignments ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE paper_category_definitions ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE paper_retrieval_documents ALTER COLUMN project_id SET NOT NULL;
