-- Align existing Supabase projects with the current research_folders schema.
--
-- Older deployments may still have the legacy unique constraint:
--   research_folders_owner_user_id_name_key UNIQUE (owner_user_id, name)
--
-- The current workspace model allows the same owner to reuse a folder name in
-- different projects, so uniqueness should include project_id.

ALTER TABLE research_folders
  DROP CONSTRAINT IF EXISTS research_folders_owner_user_id_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'research_folders_owner_user_id_project_id_name_key'
  ) THEN
    ALTER TABLE research_folders
      ADD CONSTRAINT research_folders_owner_user_id_project_id_name_key
      UNIQUE (owner_user_id, project_id, name);
  END IF;
END $$;
