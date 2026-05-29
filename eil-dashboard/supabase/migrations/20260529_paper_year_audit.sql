-- Store evidence for the publication year used by dashboard timelines.
-- The pipeline can still run before this migration is applied because the
-- worker retries paper upserts without these optional audit fields.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS year_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS year_source TEXT,
  ADD COLUMN IF NOT EXISTS year_evidence TEXT,
  ADD COLUMN IF NOT EXISTS year_candidates JSONB NOT NULL DEFAULT '[]'::jsonb;

DROP VIEW IF EXISTS trends_flat;
CREATE VIEW trends_flat WITH (security_invoker = true) AS
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
CREATE VIEW tracks_single_flat WITH (security_invoker = true) AS
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
CREATE VIEW tracks_multi_flat WITH (security_invoker = true) AS
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
CREATE VIEW papers_full WITH (security_invoker = true) AS
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
