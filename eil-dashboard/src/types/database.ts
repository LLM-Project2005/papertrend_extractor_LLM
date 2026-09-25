export type PaperId = string;

export interface TrendRow {
  paper_id: PaperId;
  folder_id?: string | null;
  year: string;
  year_confidence?: number | null;
  year_source?: string | null;
  year_evidence?: string | null;
  year_candidates?: Array<Record<string, unknown>> | null;
  title: string;
  topic: string;
  raw_topic?: string;
  /** "method" when the row's theme is about how studies were done. */
  topic_kind?: "topic" | "method";
  keyword: string;
  keyword_frequency: number;
  evidence: string;
}

export interface CorpusTopicFamily {
  id: string;
  canonicalTopic: string;
  aliases: string[];
  representativeKeywords: string[];
  relatedKeywords: string[];
  matchedTerms: string[];
  evidenceSnippets: string[];
  paperIds: PaperId[];
  folderIds: string[];
  years: string[];
  totalKeywordFrequency: number;
  /** "method" when the theme is about how studies were done; absent means a topic. */
  kind?: "topic" | "method";
}

export interface TrackRow {
  paper_id: PaperId;
  folder_id?: string | null;
  year: string;
  year_confidence?: number | null;
  year_source?: string | null;
  year_evidence?: string | null;
  year_candidates?: Array<Record<string, unknown>> | null;
  title: string;
  el: number;
  eli: number;
  lae: number;
  other: number;
}

export interface CategoryAssignmentRow {
  paper_id: PaperId;
  folder_id?: string | null;
  year: string;
  title: string;
  taxonomy_name?: string | null;
  category_key: string;
  category_label: string;
  assignment_type: "single" | "multi";
  is_other?: boolean | null;
  rationale?: string | null;
  position?: number | null;
}

export interface DashboardData {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  categoryAssignments?: CategoryAssignmentRow[];
  topicFamilies?: CorpusTopicFamily[];
  /** Whether the topics in view are grouped into themes yet (Cloud SQL only). */
  topicThemes?: TopicThemeStatus;
  /**
   * False when the repository's analysis profile has classification switched
   * off. Category data is then not served and no category chart is drawn: the
   * rows that exist are defaults written when there was nothing to classify
   * against. Undefined means unknown - treated as on, as before.
   */
  classificationEnabled?: boolean;
  useMock: boolean;
  diagnostics?: {
    dataSource?: "scoped" | "legacy_fallback" | "mock" | "empty";
    recoveredFromLegacyScope?: boolean;
    scopeDescription?: string;
    errorMessage?: string;
  } | null;
}

/**
 * ready       - every topic in view is in a theme
 * pending     - some are not yet; the dashboard should ask for them to be grouped
 * unavailable - grouping cannot run now (no model, or backing off after a failure),
 *               so those topics show under their papers' own labels
 */
export interface TopicThemeStatus {
  status: "ready" | "pending" | "unavailable";
  ungroupedTopics: number;
  groupedAt: string | null;
}

export type DashboardDataMode = "auto" | "live" | "mock";

export interface DbPaper {
  id: number;
  owner_user_id?: string | null;
  folder_id?: string | null;
  year: string;
  year_confidence?: number | null;
  year_source?: string | null;
  year_evidence?: string | null;
  year_candidates?: Array<Record<string, unknown>> | null;
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
  analysis_profile?: import("@/types/workspace").ProjectAnalysisProfile | null;
  analysis_profile_version?: number | null;
  analysis_profile_hash?: string | null;
  analysis_profile_updated_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectReclassificationJobRow {
  id: string;
  owner_user_id?: string;
  project_id: string;
  target_profile: import("@/types/workspace").ProjectAnalysisProfile;
  target_profile_hash: string;
  target_profile_version: number;
  status: "queued" | "processing" | "succeeded" | "failed" | "canceled";
  total_items: number;
  processed_items: number;
  failed_items: number;
  progress_stage: string;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
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
  paper_id: PaperId;
  owner_user_id?: string | null;
  folder_id?: string | null;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
  created_at?: string;
}

export interface DbPaperTrack {
  paper_id: PaperId;
  owner_user_id?: string | null;
  folder_id?: string | null;
  el: number;
  eli: number;
  lae: number;
  other: number;
  created_at?: string;
}

export interface DbPaperContent {
  paper_id: PaperId;
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
  /** The analysed paper's title, joined in by the Library list (not a column). */
  paper_title?: string | null;
}

export interface PaperFullRow {
  paper_id: PaperId;
  folder_id?: string | null;
  year: string;
  year_confidence?: number | null;
  year_source?: string | null;
  year_evidence?: string | null;
  year_candidates?: Array<Record<string, unknown>> | null;
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

export interface RunAnalysisConcept {
  label: string;
  matchedTerms: string[];
  relatedKeywords: string[];
  totalFrequency: number;
  firstEvidence: string;
  evidenceSnippets: string[];
}

export interface RunAnalysisFacet {
  facetType: string;
  label: string;
  evidence: string;
}

/** What the analysis extracted beyond topics (Cloud SQL workspaces). */
export interface RunAnalysisExtracted {
  year: { source: string; confidence: number; evidence: string } | null;
  typology: { primary: string; secondary: string | null; statedPurpose: string; verdict: string } | null;
  /** The keyword list printed in the paper itself. */
  authorKeywords: string[];
  /** Topic labels the analysis marked as research methods. */
  methodTopics: string[];
  /** Stages that fell back to a weaker result, in plain words. */
  analysisNotes: string[];
  duplicateOf: { title: string; score: number } | null;
}

export interface RunAnalysisDetail {
  available: boolean;
  extracted?: RunAnalysisExtracted | null;
  paper_id?: PaperId | null;
  title?: string | null;
  year?: string | null;
  raw_text?: string | null;
  abstract_claims?: string | null;
  methods?: string | null;
  results?: string | null;
  conclusion?: string | null;
  source_filename?: string | null;
  ingestion_run_id?: string | null;
  topics: string[];
  keywords: RunAnalysisKeyword[];
  concepts: RunAnalysisConcept[];
  facets: RunAnalysisFacet[];
  tracksSingle: string[];
  tracksMulti: string[];
  classification?: {
    taxonomyName: string;
    primaryCategory: string;
    additionalCategories: string[];
    rationale: string;
    profileVersion: number;
    classifiedAt: string | null;
    classifierModel: string;
    status: "current" | "previous_profile";
  } | null;
  warnings?: string[];
  diagnostics?: {
    dataSource?: string;
    recoveredFromLegacyScope?: boolean;
    missingOutputs?: string[];
  } | null;
}
