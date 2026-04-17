export interface TrendRow {
  paper_id: number;
  folder_id?: string | null;
  year: string;
  title: string;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
}

export interface TrackRow {
  paper_id: number;
  folder_id?: string | null;
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

export type DashboardDataMode = "auto" | "live" | "mock";

export interface DbPaper {
  id: number;
  owner_user_id?: string | null;
  folder_id?: string | null;
  year: string;
  title: string;
  created_at?: string;
}

export interface WorkspaceOrganizationRow {
  id: string;
  owner_user_id?: string | null;
  name: string;
  type: "personal" | "academic" | "research_lab" | "department" | "company" | "other";
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceProjectRow {
  id: string;
  organization_id: string;
  owner_user_id?: string | null;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ResearchFolderRow {
  id: string;
  owner_user_id?: string | null;
  organization_id?: string | null;
  project_id?: string | null;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FolderAnalysisJobRow {
  id: string;
  owner_user_id?: string | null;
  folder_id: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  total_runs: number;
  queued_runs: number;
  processing_runs: number;
  succeeded_runs: number;
  failed_runs: number;
  progress_stage?: string | null;
  progress_message?: string | null;
  progress_detail?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface DbPaperKeyword {
  id?: number;
  paper_id: number;
  owner_user_id?: string | null;
  folder_id?: string | null;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
  created_at?: string;
}

export interface DbPaperTrack {
  paper_id: number;
  owner_user_id?: string | null;
  folder_id?: string | null;
  el: number;
  eli: number;
  lae: number;
  other: number;
  created_at?: string;
}

export interface DbPaperContent {
  paper_id: number;
  owner_user_id?: string | null;
  folder_id?: string | null;
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
  folder_id?: string | null;
  folder_analysis_job_id?: string | null;
  source_type: "batch" | "upload";
  status: "queued" | "processing" | "succeeded" | "failed";
  source_filename?: string | null;
  display_name?: string | null;
  source_path?: string | null;
  source_extension?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  provider?: string | null;
  model?: string | null;
  is_favorite?: boolean;
  trashed_at?: string | null;
  copied_from_run_id?: string | null;
  input_payload?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface PaperFullRow {
  paper_id: number;
  folder_id?: string | null;
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

export interface RunAnalysisKeyword {
  keyword: string;
  topic: string;
  frequency: number;
  evidence: string;
}

export interface RunAnalysisDetail {
  available: boolean;
  paper_id?: number | null;
  title?: string | null;
  year?: string | null;
  abstract_claims?: string | null;
  methods?: string | null;
  results?: string | null;
  conclusion?: string | null;
  source_filename?: string | null;
  ingestion_run_id?: string | null;
  topics: string[];
  keywords: RunAnalysisKeyword[];
  tracksSingle: string[];
  tracksMulti: string[];
}
