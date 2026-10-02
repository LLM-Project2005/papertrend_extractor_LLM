-- A ledger of the migrations applied to this database (docs/32, long-term
-- health: "record the database schema").
--
-- Until now nothing recorded which files in cloudsql/ had been run; that was
-- worked out by looking for the objects each one creates. Every migration from
-- this one on inserts its own row before it commits, so a migration and its
-- record land together, whether it is applied with
-- `npm run cloudsql:migrate` or pasted into Cloud SQL Studio, and the apply
-- script refuses a file that is already recorded.
--
-- The earlier rows below were checked on 2026-10-02, read-only, by the objects
-- each file creates. phase3_owner_rls.sql is not listed: it is a preparation
-- script that says not to run it, and the live tables it would force row-level
-- security on do not have it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name        TEXT PRIMARY KEY CHECK (name ~ '^[0-9a-z_]+\.sql$'),
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user,
  note        TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 200)
);

INSERT INTO public.schema_migrations (name, applied_at, note) VALUES
  ('schema.sql', '2026-09-01T00:00:00Z', 'base schema; recorded by the ledger, applied before it'),
  ('phase4_identity_mapping.sql', '2026-09-01T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('phase8_repository_chat.sql', '2026-09-01T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('phase8_chat_v2.sql', '2026-09-01T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('phase8_knowledge_chat_v3.sql', '2026-09-01T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20260909_dynamic_paper_categories.sql', '2026-09-09T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20260909_quota_exempt_admins.sql', '2026-09-09T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20260909_repository_semantic_map.sql', '2026-09-09T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20260910_project_analysis_profiles.sql', '2026-09-10T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20260915_semantic_map_euclidean.sql', '2026-09-15T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20260929_invite_codes.sql', '2026-09-29T00:00:00Z', 'applied before the ledger; checked by its objects'),
  ('20261002_schema_migrations.sql', now(), '')
ON CONFLICT (name) DO NOTHING;

-- Read by the apply script and by an admin; written only by a migration.
GRANT SELECT, INSERT ON TABLE public.schema_migrations TO papertrend_app;

COMMIT;
