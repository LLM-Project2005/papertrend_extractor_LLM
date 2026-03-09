-- ═══════════════════════════════════════════════════════════════════
-- EIL Research Trend Dashboard — Supabase Schema
-- ═══════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).
-- It creates four tables, indexes, RLS policies for public read,
-- and three convenience views consumed by the Next.js app.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Papers ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS papers (
  id          BIGINT       PRIMARY KEY,        -- matches paper_id from the CSV
  year        TEXT         NOT NULL,
  title       TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT now()
);

-- ─── 2. Paper Keywords / Trends ────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_keywords (
  id                  BIGSERIAL    PRIMARY KEY,
  paper_id            BIGINT       NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  topic               TEXT         NOT NULL,
  keyword             TEXT         NOT NULL,
  keyword_frequency   INT          DEFAULT 1,
  evidence            TEXT,
  created_at          TIMESTAMPTZ  DEFAULT now()
);

-- ─── 3. Track Classification — Single Choice ──────────────────────
--     Exactly one track flag = 1 per paper.
CREATE TABLE IF NOT EXISTS paper_tracks_single (
  paper_id    BIGINT   PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  el          SMALLINT DEFAULT 0 CHECK (el    IN (0, 1)),
  eli         SMALLINT DEFAULT 0 CHECK (eli   IN (0, 1)),
  lae         SMALLINT DEFAULT 0 CHECK (lae   IN (0, 1)),
  other       SMALLINT DEFAULT 0 CHECK (other IN (0, 1)),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── 4. Track Classification — Multi-Label ────────────────────────
--     Multiple track flags may be 1 per paper.
CREATE TABLE IF NOT EXISTS paper_tracks_multi (
  paper_id    BIGINT   PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  el          SMALLINT DEFAULT 0 CHECK (el    IN (0, 1)),
  eli         SMALLINT DEFAULT 0 CHECK (eli   IN (0, 1)),
  lae         SMALLINT DEFAULT 0 CHECK (lae   IN (0, 1)),
  other       SMALLINT DEFAULT 0 CHECK (other IN (0, 1)),
  created_at  TIMESTAMPTZ DEFAULT now()
);


-- ─── 5. Paper Content — Raw & Segmented Text ─────────────────────
CREATE TABLE IF NOT EXISTS paper_content (
  paper_id    BIGINT   PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  raw_text    TEXT,                          -- full raw research paper text
  abstract    TEXT,                          -- abstract section
  body        TEXT,                          -- เนื้อหา (body / content section)
  conclusion  TEXT,                          -- สรุป (conclusion / summary section)
  created_at  TIMESTAMPTZ DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_papers_year              ON papers(year);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_paper_id  ON paper_keywords(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_keyword   ON paper_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_topic     ON paper_keywords(topic);


-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY  (public read-only dashboard)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE papers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_keywords      ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_tracks_single ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_tracks_multi  ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_content       ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including anon) to SELECT
CREATE POLICY "anon_read" ON papers              FOR SELECT USING (true);
CREATE POLICY "anon_read" ON paper_keywords      FOR SELECT USING (true);
CREATE POLICY "anon_read" ON paper_tracks_single FOR SELECT USING (true);
CREATE POLICY "anon_read" ON paper_tracks_multi  FOR SELECT USING (true);
CREATE POLICY "anon_read" ON paper_content       FOR SELECT USING (true);


-- ═══════════════════════════════════════════════════════════════════
-- VIEWS  (the Next.js app queries these)
-- ═══════════════════════════════════════════════════════════════════

-- Flat trend rows (mirrors Master_Trends_Archive.csv)
CREATE OR REPLACE VIEW trends_flat AS
SELECT
  p.id   AS paper_id,
  p.year,
  p.title,
  pk.topic,
  pk.keyword,
  pk.keyword_frequency,
  pk.evidence
FROM papers p
JOIN paper_keywords pk ON pk.paper_id = p.id;

-- Single-choice track rows (mirrors EIL_Track_10years1.csv)
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

-- Multi-label track rows (mirrors EIL_Track_OneHot_Final.csv)
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

-- Paper content with metadata
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
