-- Phase 3 preparation: application-level identity context for Cloud SQL.
--
-- Do not run this as a live provider switch. Apply it only after the Cloud SQL
-- parity report passes and the application sets this transaction-local value:
--
--   SET LOCAL app.current_user_id = '<verified-auth-user-uuid>';
--
-- The database role must not be allowed to change this value from untrusted
-- request data. The backend sets it only after verifying the user's token.

CREATE OR REPLACE FUNCTION public.papertrend_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;

DO $$
DECLARE
  table_name TEXT;
  owner_tables CONSTANT TEXT[] := ARRAY[
    'papers',
    'workspace_organizations',
    'workspace_projects',
    'research_folders',
    'paper_keywords',
    'paper_tracks_single',
    'paper_tracks_multi',
    'ingestion_runs',
    'folder_analysis_jobs',
    'paper_content',
    'paper_keyword_concepts',
    'paper_analysis_facets',
    'paper_author_keywords',
    'paper_research_typologies',
    'paper_category_definitions',
    'paper_category_assignments',
    'workspace_threads',
    'workspace_messages',
    'deep_research_sessions',
    'deep_research_steps',
    'ai_usage_events',
    'workspace_analytics_cache',
    'file_fingerprints'
  ];
BEGIN
  FOREACH table_name IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS papertrend_owner_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY papertrend_owner_access ON public.%I FOR ALL USING (owner_user_id = public.papertrend_current_user_id()) WITH CHECK (owner_user_id = public.papertrend_current_user_id())',
      table_name
    );
  END LOOP;

  ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS papertrend_profile_access ON public.user_profiles;
  CREATE POLICY papertrend_profile_access ON public.user_profiles
    FOR ALL
    USING (id = public.papertrend_current_user_id())
    WITH CHECK (id = public.papertrend_current_user_id());

  ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.google_drive_connections FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS papertrend_drive_access ON public.google_drive_connections;
  CREATE POLICY papertrend_drive_access ON public.google_drive_connections
    FOR ALL
    USING (user_id = public.papertrend_current_user_id())
    WITH CHECK (user_id = public.papertrend_current_user_id());
END $$;

-- Operational rate-limit rows are server-only. They intentionally receive no
-- end-user policy; the dedicated backend role must handle these writes.
ALTER TABLE public.security_rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_rate_limit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS papertrend_rate_limit_server_only ON public.security_rate_limit_events;
