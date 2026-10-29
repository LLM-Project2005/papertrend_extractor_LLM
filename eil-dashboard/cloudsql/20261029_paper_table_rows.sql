-- The paper table's rows and its cells' conversations (docs/42, 2026-10-29).
--
-- left_out: the papers the reader left out of a table, by paper id, each with
-- its reason ({"<paper id>": {"reason": "...", "columnId": "..."}}); columnId
-- names the yes/no column whose No left it out. A paper left out is not shown,
-- read or downloaded, and its cells are kept.
--
-- cell_chats: the Chat conversation asked from each cell, by cell key
-- ({"<paper id>:<column id>": "<thread id>"}), so a cell opens its own
-- conversation again.
--
-- Additive: two columns with empty defaults on one table; no row changes.

BEGIN;

ALTER TABLE public.paper_tables
  ADD COLUMN IF NOT EXISTS left_out JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(left_out) = 'object');
ALTER TABLE public.paper_tables
  ADD COLUMN IF NOT EXISTS cell_chats JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(cell_chats) = 'object');

INSERT INTO public.schema_migrations (name) VALUES ('20261029_paper_table_rows.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
