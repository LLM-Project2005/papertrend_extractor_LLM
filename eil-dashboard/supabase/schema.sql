-- ==================================================================
-- EIL Research Trend Dashboard - Supabase Schema
-- ==================================================================
-- Run this in the Supabase SQL Editor.
-- This schema is additive-only so preview work can share the same
-- Supabase project without breaking the current production contract.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- 1. Papers
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS papers (
  id          BIGINT PRIMARY KEY,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id   UUID,
  year        TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 1a. Organizations and projects
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- ------------------------------------------------------------------
-- 1b. Research folders
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS research_folders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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
-- 1d. Google Drive Connections
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_drive_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- ------------------------------------------------------------------
-- 7. Canonical keyword concepts
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_keyword_concepts (
  id                BIGSERIAL PRIMARY KEY,
  paper_id          BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id   UUID,
  facet_type  TEXT NOT NULL
              CHECK (facet_type IN ('objective_verb', 'contribution_type')),
  label       TEXT NOT NULL,
  evidence    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 9. Workspace threads and research sessions
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_keywords
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_tracks_single
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_tracks_multi
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE ingestion_runs
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE paper_analysis_facets
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id UUID;

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
CREATE INDEX IF NOT EXISTS idx_workspace_threads_owner_user_id ON workspace_threads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_threads_folder_id ON workspace_threads(folder_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_thread_id ON workspace_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_owner_user_id ON workspace_messages(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_thread_id ON deep_research_sessions(thread_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_owner_user_id ON deep_research_sessions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_folder_id ON deep_research_sessions(folder_id);
CREATE INDEX IF NOT EXISTS idx_deep_research_sessions_status ON deep_research_sessions(status);
CREATE INDEX IF NOT EXISTS idx_deep_research_steps_session_id ON deep_research_steps(session_id);

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('paper-uploads', 'paper-uploads', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

-- ------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------------
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_tracks_single ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_tracks_multi ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_keyword_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_analysis_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_research_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read" ON papers;
DROP POLICY IF EXISTS "anon_read" ON paper_keywords;
DROP POLICY IF EXISTS "anon_read" ON paper_tracks_single;
DROP POLICY IF EXISTS "anon_read" ON paper_tracks_multi;
DROP POLICY IF EXISTS "anon_read" ON paper_content;
DROP POLICY IF EXISTS "anon_read" ON paper_keyword_concepts;
DROP POLICY IF EXISTS "anon_read" ON paper_analysis_facets;

DO $$
BEGIN
  CREATE POLICY "papers_select_own" ON papers
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspace_organizations_select_own" ON workspace_organizations
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspace_projects_select_own" ON workspace_projects
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "research_folders_select_own" ON research_folders
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "profiles_select_own" ON user_profiles
  FOR SELECT USING (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "profiles_insert_own" ON user_profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND email = auth.jwt() ->> 'email'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "profiles_update_own" ON user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND email = auth.jwt() ->> 'email'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "google_drive_connections_select_own" ON google_drive_connections
  FOR SELECT USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "google_drive_connections_insert_own" ON google_drive_connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "google_drive_connections_update_own" ON google_drive_connections
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "google_drive_connections_delete_own" ON google_drive_connections
  FOR DELETE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_keywords_select_own" ON paper_keywords
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_tracks_single_select_own" ON paper_tracks_single
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_tracks_multi_select_own" ON paper_tracks_multi
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_content_select_own" ON paper_content
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_keyword_concepts_select_own" ON paper_keyword_concepts
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "paper_analysis_facets_select_own" ON paper_analysis_facets
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "folder_analysis_jobs_select_own" ON folder_analysis_jobs
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspace_threads_select_own" ON workspace_threads
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspace_messages_select_own" ON workspace_messages
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "deep_research_sessions_select_own" ON deep_research_sessions
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "deep_research_steps_select_own" ON deep_research_steps
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "ingestion_runs_select_own" ON ingestion_runs
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- ------------------------------------------------------------------
-- AUTH PROFILE SYNC
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_profile_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_full_name TEXT;
  next_avatar_url TEXT;
  next_role TEXT;
BEGIN
  next_full_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    NEW.raw_user_meta_data ->> 'user_name',
    NEW.raw_user_meta_data ->> 'preferred_username'
  );

  next_avatar_url := COALESCE(
    NEW.raw_user_meta_data ->> 'avatar_url',
    NEW.raw_user_meta_data ->> 'picture'
  );

  next_role := CASE
    WHEN lower(COALESCE(NEW.email, '')) = 'p.chantarusorn@gmail.com' THEN 'admin'
    ELSE 'member'
  END;

  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    avatar_url,
    role,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    next_full_name,
    next_avatar_url,
    next_role,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
    role = CASE
      WHEN EXCLUDED.email IS NOT NULL
       AND lower(EXCLUDED.email) = 'p.chantarusorn@gmail.com' THEN 'admin'
      ELSE public.user_profiles.role
    END,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_user_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  preserved_role TEXT := 'member';
BEGIN
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    preserved_role := OLD.role;
  END IF;

  NEW.role := CASE
    WHEN lower(COALESCE(NEW.email, '')) = 'p.chantarusorn@gmail.com' THEN 'admin'
    ELSE preserved_role
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_profile_sync ON auth.users;
CREATE TRIGGER on_auth_user_profile_sync
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_profile_from_auth();

DROP TRIGGER IF EXISTS on_user_profile_normalize ON public.user_profiles;
CREATE TRIGGER on_user_profile_normalize
BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.normalize_user_profile();

INSERT INTO public.user_profiles (
  id,
  email,
  full_name,
  avatar_url,
  role,
  created_at,
  updated_at
)
SELECT
  users.id,
  users.email,
  COALESCE(
    users.raw_user_meta_data ->> 'full_name',
    users.raw_user_meta_data ->> 'name',
    users.raw_user_meta_data ->> 'user_name',
    users.raw_user_meta_data ->> 'preferred_username'
  ),
  COALESCE(
    users.raw_user_meta_data ->> 'avatar_url',
    users.raw_user_meta_data ->> 'picture'
  ),
  CASE
    WHEN lower(COALESCE(users.email, '')) = 'p.chantarusorn@gmail.com' THEN 'admin'
    ELSE 'member'
  END,
  now(),
  now()
FROM auth.users AS users
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
  avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
  role = CASE
    WHEN EXCLUDED.email IS NOT NULL
     AND lower(EXCLUDED.email) = 'p.chantarusorn@gmail.com' THEN 'admin'
    ELSE public.user_profiles.role
  END,
  updated_at = now();

-- ------------------------------------------------------------------
-- VIEWS consumed by the Next.js app
-- ------------------------------------------------------------------
DROP VIEW IF EXISTS trends_flat;
CREATE VIEW trends_flat WITH (security_invoker = true) AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  pk.topic,
  pk.keyword,
  pk.keyword_frequency,
  pk.evidence
FROM papers p
JOIN paper_keywords pk ON pk.paper_id = p.id;

DROP VIEW IF EXISTS tracks_single_flat;
CREATE VIEW tracks_single_flat WITH (security_invoker = true) AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  ts.el,
  ts.eli,
  ts.lae,
  ts.other
FROM papers p
JOIN paper_tracks_single ts ON ts.paper_id = p.id;

DROP VIEW IF EXISTS tracks_multi_flat;
CREATE VIEW tracks_multi_flat WITH (security_invoker = true) AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
  p.title,
  tm.el,
  tm.eli,
  tm.lae,
  tm.other
FROM papers p
JOIN paper_tracks_multi tm ON tm.paper_id = p.id;

DROP VIEW IF EXISTS papers_full;
CREATE VIEW papers_full WITH (security_invoker = true) AS
SELECT
  p.id AS paper_id,
  p.owner_user_id,
  p.folder_id,
  p.year,
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
CREATE VIEW concepts_flat WITH (security_invoker = true) AS
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
CREATE VIEW paper_facets_flat WITH (security_invoker = true) AS
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
