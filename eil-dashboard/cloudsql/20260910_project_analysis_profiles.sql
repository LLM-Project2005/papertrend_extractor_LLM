-- Repository-owned analysis profiles and classification provenance.
-- Additive and safe to run multiple times.
BEGIN;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.project_reclassification_jobs,
  public.project_reclassification_items
  TO papertrend_app;

COMMIT;
