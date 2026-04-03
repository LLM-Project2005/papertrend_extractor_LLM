export type ChatMode = "normal" | "deep_research";

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
    paperId: number;
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
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
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
