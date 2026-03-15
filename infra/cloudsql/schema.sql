-- Cloud SQL PostgreSQL schema for EIL Research Trend Dashboard
-- Migrated from Supabase-oriented schema.

CREATE TABLE IF NOT EXISTS papers (
  id          BIGINT       PRIMARY KEY,
  year        TEXT         NOT NULL,
  title       TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_keywords (
  id                  BIGSERIAL    PRIMARY KEY,
  paper_id            BIGINT       NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  topic               TEXT         NOT NULL,
  keyword             TEXT         NOT NULL,
  keyword_frequency   INT          DEFAULT 1,
  evidence            TEXT,
  created_at          TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_tracks_single (
  paper_id    BIGINT   PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  el          SMALLINT DEFAULT 0 CHECK (el IN (0, 1)),
  eli         SMALLINT DEFAULT 0 CHECK (eli IN (0, 1)),
  lae         SMALLINT DEFAULT 0 CHECK (lae IN (0, 1)),
  other       SMALLINT DEFAULT 0 CHECK (other IN (0, 1)),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_tracks_multi (
  paper_id    BIGINT   PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  el          SMALLINT DEFAULT 0 CHECK (el IN (0, 1)),
  eli         SMALLINT DEFAULT 0 CHECK (eli IN (0, 1)),
  lae         SMALLINT DEFAULT 0 CHECK (lae IN (0, 1)),
  other       SMALLINT DEFAULT 0 CHECK (other IN (0, 1)),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_content (
  paper_id    BIGINT   PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  raw_text    TEXT,
  abstract    TEXT,
  body        TEXT,
  conclusion  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_paper_id ON paper_keywords(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_keyword ON paper_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_topic ON paper_keywords(topic);

CREATE OR REPLACE VIEW trends_flat AS
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

CREATE OR REPLACE VIEW tracks_single_flat AS
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

CREATE OR REPLACE VIEW tracks_multi_flat AS
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

CREATE OR REPLACE VIEW papers_full AS
SELECT
  p.id AS paper_id,
  p.year,
  p.title,
  pc.abstract,
  pc.body,
  pc.conclusion,
  pc.raw_text
FROM papers p
LEFT JOIN paper_content pc ON pc.paper_id = p.id;
