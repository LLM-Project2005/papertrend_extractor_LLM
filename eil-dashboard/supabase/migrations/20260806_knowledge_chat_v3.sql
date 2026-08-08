-- Knowledge Chat V3 supports owner-wide reports that are not tied to one project.
ALTER TABLE public.repository_chat_jobs
  ALTER COLUMN project_id DROP NOT NULL;
