-- Papertrend beta hardening: rate limits, AI usage, cache tables, and hot-path indexes.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS security_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  ip_hash TEXT,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL DEFAULT 'attempt',
  allowed BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_kind TEXT NOT NULL CHECK (
    usage_kind IN ('chat_message', 'web_search', 'chart', 'deep_research')
  ),
  units INT NOT NULL DEFAULT 1 CHECK (units > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_analytics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

ALTER TABLE security_rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_fingerprints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "security_rate_limit_events_select_own" ON security_rate_limit_events
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "ai_usage_events_select_own" ON ai_usage_events
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspace_analytics_cache_select_own" ON workspace_analytics_cache
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "file_fingerprints_select_own" ON file_fingerprints
  FOR SELECT USING (auth.uid() = owner_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
