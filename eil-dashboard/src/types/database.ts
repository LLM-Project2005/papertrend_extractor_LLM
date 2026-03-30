export interface TrendRow {
  paper_id: number;
  year: string;
  title: string;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
}

export interface TrackRow {
  paper_id: number;
  year: string;
  title: string;
  el: number;
  eli: number;
  lae: number;
  other: number;
}

export interface DashboardData {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  useMock: boolean;
}

export interface DbPaper {
  id: number;
  owner_user_id?: string | null;
  year: string;
  title: string;
  created_at?: string;
}

export interface DbPaperKeyword {
  id?: number;
  paper_id: number;
  owner_user_id?: string | null;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
  created_at?: string;
}

export interface DbPaperTrack {
  paper_id: number;
  owner_user_id?: string | null;
  el: number;
  eli: number;
  lae: number;
  other: number;
  created_at?: string;
}

export interface DbPaperContent {
  paper_id: number;
  owner_user_id?: string | null;
  raw_text?: string | null;
  abstract?: string | null;
  abstract_claims?: string | null;
  body?: string | null;
  methods?: string | null;
  results?: string | null;
  conclusion?: string | null;
  source_filename?: string | null;
  source_path?: string | null;
  ingestion_run_id?: string | null;
  created_at?: string;
}

export interface IngestionRunRow {
  id: string;
  owner_user_id?: string | null;
  source_type: "batch" | "upload";
  status: "queued" | "processing" | "succeeded" | "failed";
  source_filename?: string | null;
  source_path?: string | null;
  provider?: string | null;
  model?: string | null;
  input_payload?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface PaperFullRow {
  paper_id: number;
  year: string;
  title: string;
  abstract?: string | null;
  abstract_claims?: string | null;
  methods?: string | null;
  results?: string | null;
  body?: string | null;
  conclusion?: string | null;
  raw_text?: string | null;
  source_filename?: string | null;
  source_path?: string | null;
  ingestion_run_id?: string | null;
}
