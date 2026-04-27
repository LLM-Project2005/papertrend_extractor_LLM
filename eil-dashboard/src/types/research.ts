export type ChatMode = "normal" | "deep_research";

export interface DeepResearchCitationRef {
  source_id: string;
  source_label: string;
  locator?: string | null;
  snippet?: string | null;
  confidence?: "high" | "medium" | "low";
}

export interface DeepResearchQueryBundle {
  primary_query?: string;
  supporting_queries?: string[];
  exact_title_query?: string | null;
  section_query?: string | null;
  author_hint?: string | null;
  requested_sections?: string[];
  exclusion_ids?: Array<number | string>;
}

export interface DeepResearchEvidenceItem {
  paperId: number | string;
  title: string;
  section: string;
  requested_section: string;
  snippet: string;
  relevance_score: number;
  noise_score: number;
  supports_section: boolean;
}

export interface DeepResearchRankedMatch {
  paperId: number | string;
  title: string;
  year: string;
  score: number;
  strong_title_match?: boolean;
  exact_normalized_title_match?: boolean;
  selected_scope_anchor?: boolean;
  score_components?: {
    title?: number;
    selected_scope_anchor?: number;
    author_hint?: number;
    requested_sections?: number;
    general_content?: number;
    noise_penalty?: number;
    duplicate_penalty?: number;
  };
}

export interface DeepResearchStepDiagnostics {
  target_resolution?: string;
  top_ranked_candidates?: DeepResearchRankedMatch[];
  evidence_item_count?: number;
  selected_evidence_counts?: Record<string, number>;
  discarded_noisy_snippet_counts?: Record<string, number>;
  unresolved_sections?: string[];
  verification_warnings?: string[];
}

export interface DeepResearchStepInputPayload {
  payload_version?: number;
  planner_version?: string;
  projectId?: string;
  selectedRunIds?: string[];
  promptAnalysis?: Record<string, unknown>;
  queryBundle?: DeepResearchQueryBundle;
  normalizedQuery?: DeepResearchQueryBundle;
  targetTitle?: string;
  targetPaperId?: number | string;
  requestedSections?: string[];
  exclusionIds?: Array<number | string>;
  phaseClass?: "research" | "verification" | "synthesis";
  requiredClass?:
    | "required_before_verification"
    | "optional_context"
    | "verification"
    | "synthesis";
  origin?: "initial" | "replanned" | "verification_generated";
  purpose?: string;
  expectedOutput?: string;
  completionCondition?: string;
  supersedesTodoId?: string | null;
  statusReason?: string | null;
}

export interface DeepResearchStepOutputPayload {
  payload_version?: number;
  summary?: string;
  detail?: string;
  citations?: DeepResearchCitationRef[];
  result_kind?:
    | "document_hit"
    | "document_miss"
    | "comparison"
    | "scope_gap"
    | "insufficient_evidence"
    | "verification"
    | "synthesis_input"
    | "tool_failure"
    | "obsolete"
    | "blocked"
    | "conflicting_evidence";
  diagnostics?: Record<string, unknown>;
  raw?:
    | {
        queryBundle?: DeepResearchQueryBundle;
        rankedMatches?: DeepResearchRankedMatch[];
        evidenceItems?: DeepResearchEvidenceItem[];
        diagnostics?: DeepResearchStepDiagnostics;
      }
    | unknown;
  status_reason?: string | null;
  completion_kind?: "full" | "partial";
}

export interface WorkspaceThreadSummary {
  id: string;
  owner_user_id?: string | null;
  folder_id?: string | null;
  mode: ChatMode;
  title: string;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceMessageRecord {
  id: string;
  thread_id: string;
  owner_user_id?: string | null;
  folder_id?: string | null;
  role: "user" | "assistant" | "system";
  message_kind: "chat" | "deep_research_plan" | "deep_research_report" | "status";
  content: string;
  citations?: Array<{
    paperId: number | string;
    title: string;
    year: string;
    href: string;
    reason: string;
  }>;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface DeepResearchStepRecord {
  id: string;
  session_id: string;
  owner_user_id?: string | null;
  position: number;
  title: string;
  description?: string | null;
  tool_name?: string | null;
  status: "planned" | "processing" | "completed" | "failed" | "waiting";
  input_payload?: DeepResearchStepInputPayload | null;
  output_payload?: DeepResearchStepOutputPayload | null;
  created_at?: string;
  updated_at?: string;
}

export interface DeepResearchSessionRecord {
  id: string;
  thread_id: string;
  owner_user_id?: string | null;
  folder_id?: string | null;
  status:
    | "planned"
    | "queued"
    | "waiting_on_analysis"
    | "processing"
    | "completed"
    | "failed"
    | "canceled";
  prompt: string;
  plan_summary?: string | null;
  final_report?: string | null;
  requires_analysis: boolean;
  pending_run_count: number;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  steps?: DeepResearchStepRecord[];
}

export interface ChatThreadDetail {
  thread: WorkspaceThreadSummary;
  messages: WorkspaceMessageRecord[];
  deepResearchSession?: DeepResearchSessionRecord | null;
}
