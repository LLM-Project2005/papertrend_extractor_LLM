/* ────────────────────────────────────────────────────────────────
   Shared TypeScript types for the EIL Dashboard
   ──────────────────────────────────────────────────────────────── */

/** One row in Master_Trends_Archive (keyword-level) */
export interface TrendRow {
  paper_id: number;
  year: string;
  title: string;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
}

/** One row in the track tables (single-choice or multi-label) */
export interface TrackRow {
  paper_id: number;
  year: string;
  title: string;
  el: number;
  eli: number;
  lae: number;
  other: number;
}

/** Combined dashboard payload */
export interface DashboardData {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  useMock: boolean;
}

/* ── Supabase row types (matching DB schema) ────────────────── */

export interface DbPaper {
  id: number;
  year: string;
  title: string;
  created_at?: string;
}

export interface DbPaperKeyword {
  id?: number;
  paper_id: number;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
  created_at?: string;
}

export interface DbPaperTrack {
  paper_id: number;
  el: number;
  eli: number;
  lae: number;
  other: number;
  created_at?: string;
}

export interface DbPaperContent {
  paper_id: number;
  raw_text?: string;
  abstract?: string;
  body?: string;
  conclusion?: string;
  created_at?: string;
}
