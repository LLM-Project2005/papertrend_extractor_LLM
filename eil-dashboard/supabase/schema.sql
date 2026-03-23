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
  year        TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------
-- 1b. User Profiles
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
-- 2. Paper Keywords / Trends
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_keywords (
  id                 BIGSERIAL PRIMARY KEY,
  paper_id           BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
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
  source_type      TEXT NOT NULL CHECK (source_type IN ('batch', 'upload')),
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  source_filename  TEXT,
  source_path      TEXT,
  provider         TEXT,
  model            TEXT,
  input_payload    JSONB DEFAULT '{}'::jsonb,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- 6. Paper Content - Canonical section store
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_content (
  paper_id          BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
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
-- INDEXES
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_paper_id ON paper_keywords(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_keyword ON paper_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_topic ON paper_keywords(topic);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status);
CREATE INDEX IF NOT EXISTS idx_paper_content_run_id ON paper_content(ingestion_run_id);

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
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_tracks_single ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_tracks_multi ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "anon_read" ON papers FOR SELECT USING (true);
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
  CREATE POLICY "anon_read" ON paper_keywords FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "anon_read" ON paper_tracks_single FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "anon_read" ON paper_tracks_multi FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "anon_read" ON paper_content FOR SELECT USING (true);
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
CREATE VIEW trends_flat AS
SELECT
  p.id AS paper_id,
  p.year,
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
  p.year,
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
  p.year,
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
