"use client";

import { useDismiss } from "@/hooks/useDismiss";
import Link from "next/link";
import PaperLink from "@/components/workspace/PaperLink";
import { parsePaperHref } from "@/lib/paper-address";
import {
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { TRACK_COLS } from "@/lib/constants";
import {
  dedupeConversationSources,
  numberAnswerSources,
  previewConversationSources,
} from "@/lib/conversation-sources";
import { CHAT_SCOPE_TRANSFER_STORAGE_KEY } from "@/lib/workspace-session";
import { readChatScopeTransfer, runsInTransfer } from "@/lib/chat-scope-transfer";
import { normalizeChatRequestPayload } from "@/lib/chat-request-payload";
import {
  chatEndpoint,
  newChatRequestId,
  readChatStream,
  type ChatProgressUpdate,
} from "@/lib/chat-http";
import {
  ANSWER_BODY_CLASS,
  ANSWER_META_CLASS,
  ANSWER_META_SM_CLASS,
} from "@/lib/answer-typography";
import { AssistantAnswer, renderRichMessage } from "@/components/chat/AnswerBody";
import { citationPaperId, markCitations, type CitationSource } from "@/lib/answer-citations";
import { isV2Session } from "@/lib/deep-research/types";
import { ChatIntro, FollowUpSuggestions } from "@/components/chat/ChatIntro";
import ThinkingOrb, { orbStateForStage } from "@/components/ui/ThinkingOrb";
import Select from "@/components/ui/Select";
import {
  exampleQuestions,
  followUpSuggestions,
  scopeDescription,
  type ExampleQuestion,
} from "@/lib/chat-guidance";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import type {
  KnowledgeScope,
  KnowledgeScopeSnapshot,
} from "@/lib/knowledge-scope";
import {
  ChartIcon,
  ChatIcon,
  CheckIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  BooksIcon,
  OpenAIIcon,
  DriveIcon,
  ListViewIcon,
  EqualizerIcon,
  ExitFullscreenIcon,
  FileIcon,
  FolderIcon,
  FullscreenIcon,
  MoreHorizontalIcon,
  ImageIcon,
  PaperIcon,
  PencilSquareIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SidebarIcon,
  SparkIcon,
  StopIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import Modal, { useDialogLayer } from "@/components/ui/Modal";
import { useIsNarrow } from "@/lib/use-narrow";
import { useComposerOffset } from "@/lib/composer-offset";
// Charts load when an answer has one: Recharts was 106 kB on every chat page
// (docs/32, 3.3). The placeholders hold the chart's box while it loads.
const ChatChartCard = dynamic(() => import("@/components/chat/ChatChartCard"), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="h-[402px] rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]" />
  ),
});
const ChatInsightCard = dynamic(() => import("@/components/chat/ChatInsightCard"), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="h-[320px] rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]" />
  ),
});
import ReportActions from "@/components/chat/ReportActions";
import MarkdownActions, { downloadMarkdown } from "@/components/chat/MarkdownActions";
import { answerMarkdown, conversationMarkdown, isFinishedAnswer, markdownFileName } from "@/lib/answer-export";
import type { Insight } from "@/lib/insights/types";
import { safeCitationHref } from "@/lib/safe-citation-href";
import { hasUsableAnalysis } from "@/lib/usable-analysis";
import { mergeLatestMessages, NEAR_BOTTOM_PX } from "@/lib/chat-transcript";
import type {
  FolderAnalysisJobRow,
  IngestionRunRow,
  ResearchFolderRow,
} from "@/types/database";
import type {
  ChatMode,
  DeepResearchCitationRef,
  DeepResearchEvidenceItem,
  ChatThreadDetail,
  DeepResearchSessionRecord,
  DeepResearchStepRecord,
  WorkspaceMessageRecord,
  WorkspaceThreadSummary,
} from "@/types/research";

interface Citation {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason: string;
  sourceType?: "paper" | "web";
}

type ChartType = "auto" | "bar" | "line" | "pie" | "table";
type ChartMetric =
  | "papers_per_year"
  | "word_count"
  | "top_topics"
  | "top_keywords"
  | "track_distribution"
  | "topic_trend"
  | "keyword_trend"
  | "track_trend";

export interface ChatChartPayload {
  /** "insight": a computed view drawn by the Adaptive tab's renderer (docs/31). */
  chartType: Exclude<ChartType, "auto"> | "insight";
  title: string;
  scopeLabel: string;
  metric: ChartMetric | "insight";
  insight?: Insight;
  papers?: Array<{ id: string; title: string; year: string }>;
  xKey: "label";
  yKeys: string[];
  data: Array<Record<string, string | number>>;
  planner?: {
    source: "llm" | "fallback";
    reason?: string;
    confidence?: "high" | "medium" | "low";
    warnings?: string[];
  };
}

interface ChatAttachmentPayload {
  name: string;
  type?: string;
  size?: number;
  url?: string;
  previewUrl?: string;
  dataUrl?: string;
  runId?: string;
  status?: IngestionRunRow["status"];
  sourceLabel?: string;
  extension?: string;
}

interface ChatToolResult {
  type: "web_search" | "chart";
  status: "succeeded" | "failed" | "skipped";
  data?: unknown;
  citations?: Citation[];
  error?: string;
}

interface MessageView {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  kind: WorkspaceMessageRecord["message_kind"];
  metadata?: Record<string, unknown> | null;
}

interface ChatPayload {
  answer?: string;
  mode?: "grounded" | "fallback" | "analysis_queued";
  citations?: Citation[];
  toolResults?: ChatToolResult[];
  chart?: ChatChartPayload | null;
  charts?: ChatChartPayload[];
  error?: string;
  thread?: WorkspaceThreadSummary;
  messages?: WorkspaceMessageRecord[];
  deepResearchSession?: DeepResearchSessionRecord | null;
  jobId?: string | null;
  coverage?: Record<string, unknown> | null;
  limitations?: string[];
  groundingMode?: "repository" | "repository_web" | "general" | "repository_unavailable";
  scopeSnapshot?: KnowledgeScopeSnapshot | null;
  requestId?: string;
}

interface ChatSearchResult {
  id: string;
  thread: WorkspaceThreadSummary;
  message?: WorkspaceMessageRecord;
  snippet: string;
  matchedIn: "title" | "summary" | "message";
  groupLabel: string;
}

const PINNED_THREADS_STORAGE_KEY = "papertrend_pinned_chat_threads_v1";
const CHAT_MODEL_STORAGE_KEY = "papertrend_chat_model_v1";
const CHAT_PARAMETERS_STORAGE_KEY = "papertrend_chat_parameters_v1";
const DEFAULT_CHAT_MODEL = "openai/gpt-6-luna-20260922";

type ChatGenerationParameters = {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
};

type DeepResearchScope = "auto" | "attached" | "current_folder" | "project" | "workspace";
type DeepResearchQualityMode = "strict_budget" | "balanced" | "quality";

interface DeepResearchBudgetPolicy {
  maxLibraryPapers: number;
  maxWebSearches: number;
  maxSources: number;
  maxGapRounds: number;
  maxVerificationRounds: number;
  qualityMode: DeepResearchQualityMode;
}

interface DeepResearchSourcePolicy {
  scope: DeepResearchScope;
  includeAttached: boolean;
  includeCurrentScope: boolean;
  includeWorkspace: boolean;
  allowWeb: boolean;
  allowCharts: boolean;
  allowCode: boolean;
  agentDirected: boolean;
  budget: DeepResearchBudgetPolicy;
}

const DEFAULT_CHAT_PARAMETERS: ChatGenerationParameters = {
  temperature: 0.4,
  topP: 0.95,
  topK: 0,
  maxTokens: 1200,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

const STRICT_RESEARCH_BUDGET: DeepResearchBudgetPolicy = {
  maxLibraryPapers: 8,
  maxWebSearches: 5,
  maxSources: 12,
  maxGapRounds: 1,
  maxVerificationRounds: 1,
  qualityMode: "strict_budget",
};

const DEFAULT_RESEARCH_SOURCE_POLICY: DeepResearchSourcePolicy = {
  scope: "project",
  includeAttached: true,
  includeCurrentScope: true,
  includeWorkspace: false,
  allowWeb: false,
  allowCharts: true,
  allowCode: false,
  agentDirected: true,
  budget: STRICT_RESEARCH_BUDGET,
};

// One model since 2026-10-09 (docs/34): the evidence is chosen on the reader's
// model, and Gemini never narrowed it (docs/25). A second entry brings the
// picker back.
const MODEL_OPTIONS = [
  { value: "openai/gpt-6-luna-20260922", label: "GPT-6 Luna", description: "By OpenAI.", Mark: OpenAIIcon },
] as const;


const CHART_INTENT_PATTERN =
  /\b(create|build|make|show|draw|plot|visuali[sz]e)\b.{0,24}\b(chart|graph|plot)\b|\b(chart|graph|plot)\b|สร้างกราฟ|ทำกราฟ|กราฟ|แผนภูมิ/i;

function normalizeStoredModel(value: string | null) {
  return MODEL_OPTIONS.some((option) => option.value === value)
    ? String(value)
    : DEFAULT_CHAT_MODEL;
}

function chartFromMetadata(metadata?: Record<string, unknown> | null): ChatChartPayload | null {
  const chart = metadata?.chart;
  if (!chart || typeof chart !== "object") {
    return null;
  }
  const value = chart as Partial<ChatChartPayload>;
  if (!Array.isArray(value.data) || !value.title || !value.chartType) {
    return null;
  }
  return value as ChatChartPayload;
}

function chartsFromMetadata(metadata?: Record<string, unknown> | null): ChatChartPayload[] {
  const charts = metadata?.charts;
  if (Array.isArray(charts)) {
    return charts
      .map((chart) =>
        chart && typeof chart === "object" ? (chart as Partial<ChatChartPayload>) : null
      )
      .filter(
        (chart): chart is ChatChartPayload =>
          Boolean(chart?.title && chart.chartType && Array.isArray(chart.data))
      );
  }
  const chart = chartFromMetadata(metadata);
  return chart ? [chart] : [];
}

function attachmentsFromMetadata(
  metadata?: Record<string, unknown> | null
): ChatAttachmentPayload[] {
  const attachments = metadata?.attachments;
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment) =>
      attachment && typeof attachment === "object"
        ? (attachment as Partial<ChatAttachmentPayload>)
        : null
    )
    .filter(
      (attachment): attachment is ChatAttachmentPayload =>
        Boolean(attachment?.name && typeof attachment.name === "string")
    );
}

const mapMessage = (message: WorkspaceMessageRecord): MessageView => ({
  id: message.id,
  role: message.role,
  content: message.content,
  citations: message.citations ?? [],
  kind: message.message_kind,
  metadata: message.metadata ?? null,
});

/** The question an answer replied to, for its file name. */
function questionBefore(messages: MessageView[], index: number): string {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (messages[at].role === "user") return messages[at].content.split("\n")[0].slice(0, 80);
  }
  return "";
}

/**
 * Every message of a conversation, oldest first. The transcript may hold only
 * the latest page, so an export reads the pages itself (docs/32, 4.2).
 */
async function fetchWholeConversation(threadId: string, token: string): Promise<MessageView[]> {
  const pages: WorkspaceMessageRecord[][] = [];
  let before: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const query: string = before ? `?before=${encodeURIComponent(before)}` : "";
    const response = await fetch(`/api/chat/threads/${threadId}${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as ChatThreadDetail & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The conversation couldn't be loaded.");
    const messages = payload.messages ?? [];
    pages.unshift(messages);
    before = messages[0]?.created_at ?? null;
    if (!payload.hasEarlierMessages || !before) break;
  }
  const seen = new Set<string>();
  return pages
    .flat()
    .filter((message) => !seen.has(message.id) && Boolean(seen.add(message.id)))
    .map(mapMessage);
}

const localMessage = (
  role: MessageView["role"],
  content: string,
  citations: Citation[] = [],
  metadata?: Record<string, unknown>
): MessageView => ({
  id: `local-${Math.random().toString(36).slice(2, 10)}`,
  role,
  content,
  citations,
  kind: "chat",
  metadata: metadata ?? null,
});

function CitationLink({ citation, compact = false, number }: { citation: Citation; compact?: boolean; number?: number }) {
  return (
    <SourceLink
      href={safeCitationHref(citation.href)}
      className={`flex items-start gap-2.5 border border-slate-200 bg-white text-sm transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:bg-[#0a0a0a] ${
        compact ? "rounded-lg px-3 py-2" : "rounded-xl px-3.5 py-3"
      }`}
    >
      {citation.sourceType === "web" ? (
        <SearchIcon className="mt-0.5 h-4 w-4 flex-none text-slate-600 dark:text-[#8e8e8e]" />
      ) : (
        <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-slate-600 dark:text-[#8e8e8e]" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900 dark:text-[#ececec]">
          {number ? <span className="mr-1.5 tabular-nums text-slate-600 dark:text-[#a3a3a3]">[{number}]</span> : null}
          {citation.title}
        </span>
        <span className="mt-0.5 block text-xs text-slate-600 dark:text-[#8e8e8e]">
          {citation.sourceType === "web" ? "Web source" : citation.year || "Paper"}
        </span>
        {!compact && citation.reason ? (
          <span className={`mt-1.5 block ${ANSWER_META_CLASS} text-slate-600 dark:text-[#8e8e8e]`}>
            {citation.reason}
          </span>
        ) : null}
      </span>
    </SourceLink>
  );
}

/** A cited source: a paper opens in place (after the scheme check), anything else is a plain link. */
function SourceLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return parsePaperHref(href) ? (
    <PaperLink paper={href} className={className}>
      {children}
    </PaperLink>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function sortThreads(
  threads: WorkspaceThreadSummary[],
  pinnedIds: string[]
): WorkspaceThreadSummary[] {
  const pinned = new Set(pinnedIds);
  return [...threads].sort((left, right) => {
    const leftPinned = pinned.has(left.id) ? 1 : 0;
    const rightPinned = pinned.has(right.id) ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return (right.updated_at ?? "").localeCompare(left.updated_at ?? "");
  });
}

function compactSearchText(value: string, maxLength = 180) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function searchDateGroup(dateValue?: string | null) {
  const timestamp = dateValue ? new Date(dateValue).getTime() : 0;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Older";
  }
  const ageMs = Date.now() - timestamp;
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs < dayMs) return "Today";
  if (ageMs < 2 * dayMs) return "Yesterday";
  if (ageMs < 7 * dayMs) return "Previous 7 Days";
  if (ageMs < 30 * dayMs) return "Previous 30 Days";
  return "Older";
}

function findQuerySnippet(content: string, query: string) {
  const text = content.replace(/\s+/g, " ").trim();
  if (!query) return compactSearchText(text);
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return compactSearchText(text);
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + query.length + 110);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function buildChatSearchResults(
  details: ChatThreadDetail[],
  query: string
): ChatSearchResult[] {
  const needle = query.trim().toLowerCase();
  const results: ChatSearchResult[] = [];

  details.forEach((detail) => {
    const groupLabel = searchDateGroup(detail.thread.updated_at);
    const title = detail.thread.title ?? "Untitled chat";
    const summary = detail.thread.summary ?? "";

    if (!needle) {
      results.push({
        id: `${detail.thread.id}-thread`,
        thread: detail.thread,
        snippet: compactSearchText(summary || title, 120),
        matchedIn: "title",
        groupLabel,
      });
      return;
    }

    if (title.toLowerCase().includes(needle)) {
      results.push({
        id: `${detail.thread.id}-title`,
        thread: detail.thread,
        snippet: findQuerySnippet(title, needle),
        matchedIn: "title",
        groupLabel,
      });
    } else if (summary.toLowerCase().includes(needle)) {
      results.push({
        id: `${detail.thread.id}-summary`,
        thread: detail.thread,
        snippet: findQuerySnippet(summary, needle),
        matchedIn: "summary",
        groupLabel,
      });
    }

    detail.messages.forEach((message) => {
      if (!message.content?.toLowerCase().includes(needle)) {
        return;
      }
      results.push({
        id: `${detail.thread.id}-${message.id}`,
        thread: detail.thread,
        message,
        snippet: findQuerySnippet(message.content, needle),
        matchedIn: "message",
        groupLabel,
      });
    });
  });

  return results;
}

function sessionLabel(session?: DeepResearchSessionRecord | null) {
  if (!session) return null;
  const partialCompletion = session.steps?.some(
    (step) => step.output_payload?.completion_kind === "partial"
  );
  if (session.status === "planned") return "Planned";
  if (session.status === "queued") return "Queued";
  if (session.status === "waiting_on_analysis") return "Waiting on analysis";
  if (session.status === "processing") return "Researching";
  if (session.status === "completed") return partialCompletion ? "Completed (partial)" : "Completed";
  if (session.status === "failed") return "Failed";
  return null;
}

function sessionActive(session?: DeepResearchSessionRecord | null) {
  return (
    session?.status === "queued" ||
    session?.status === "waiting_on_analysis" ||
    session?.status === "processing"
  );
}

function buildFolderLabel(folderId: string, folders: ResearchFolderRow[]) {
  if (!folderId || folderId === "all") return "Entire repository";
  return folders.find((folder) => folder.id === folderId)?.name ?? "Selected folder";
}

/** The scope the last question in a conversation was asked in, as the server saved it. */
function lastQuestionScope(messages: WorkspaceMessageRecord[]): KnowledgeScope | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const scope = (message.metadata as { knowledgeScope?: unknown } | null | undefined)?.knowledgeScope;
    if (scope && typeof scope === "object" && typeof (scope as { kind?: unknown }).kind === "string") return scope as KnowledgeScope;
    return null;
  }
  return null;
}

function scopeSnapshotFromMetadata(metadata?: Record<string, unknown> | null): KnowledgeScopeSnapshot | null {
  const value = metadata?.scopeSnapshot;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<KnowledgeScopeSnapshot>;
  if (!candidate.kind || typeof candidate.label !== "string") return null;
  return {
    kind: candidate.kind,
    label: candidate.label,
    projectId: candidate.projectId ?? null,
    projectName: candidate.projectName ?? null,
    folderId: candidate.folderId ?? null,
    folderName: candidate.folderName ?? null,
    selectedRunCount: Number(candidate.selectedRunCount ?? 0),
    eligiblePaperCount: Number(candidate.eligiblePaperCount ?? 0),
  };
}

function groundingModeFromMetadata(metadata?: Record<string, unknown> | null): string {
  return typeof metadata?.groundingMode === "string" ? metadata.groundingMode : "";
}

function runTitleOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || run.id;
}

function runExtOf(run: IngestionRunRow) {
  return (
    run.source_extension ||
    runTitleOf(run).split(".").pop()?.toLowerCase() ||
    "file"
  );
}

function runSourceLabel(run: IngestionRunRow) {
  const sourceKind =
    typeof run.input_payload?.source_kind === "string"
      ? run.input_payload.source_kind
      : run.source_type;
  return sourceKind === "google-drive" ? "Google Drive" : "Upload";
}

function runGlyph(run: IngestionRunRow) {
  if (runSourceLabel(run) === "Google Drive") return DriveIcon;
  if (runExtOf(run) === "pdf") return PaperIcon;
  return FileIcon;
}

function runGlyphTone(run: IngestionRunRow) {
  const ext = runExtOf(run);
  if (ext === "pdf") {
    return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  }
  if (ext === "doc" || ext === "docx") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300";
  }
  return "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-[#d4d4d4]";
}

function attachmentExtension(attachment: ChatAttachmentPayload) {
  const fromMetadata = attachment.extension?.trim().toLowerCase();
  if (fromMetadata) {
    return fromMetadata.replace(/^\./, "");
  }
  const fromName = attachment.name.split(".").pop()?.trim().toLowerCase();
  if (fromName && fromName !== attachment.name.toLowerCase()) {
    return fromName;
  }
  const fromType = attachment.type?.split("/").pop()?.trim().toLowerCase();
  return fromType || "file";
}

function attachmentIsImage(attachment: ChatAttachmentPayload) {
  const type = attachment.type?.toLowerCase() ?? "";
  const ext = attachmentExtension(attachment);
  return (
    type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(ext)
  );
}

function attachmentPreviewSrc(attachment: ChatAttachmentPayload) {
  return attachment.previewUrl || attachment.dataUrl || attachment.url || "";
}

function formatAttachmentSize(size?: number) {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentTone(attachment: ChatAttachmentPayload) {
  const ext = attachmentExtension(attachment);
  if (ext === "pdf") {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-300/30 dark:bg-red-500/10 dark:text-red-200";
  }
  if (attachmentIsImage(attachment)) {
    return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-300/30 dark:bg-sky-500/10 dark:text-sky-100";
  }
  if (ext === "doc" || ext === "docx") {
    return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-300/30 dark:bg-blue-500/10 dark:text-blue-100";
  }
  return "border-slate-200 bg-white text-slate-700 dark:border-[#1f1f1f] dark:bg-white/5 dark:text-[#ececec]";
}

function AttachmentGlyph({ attachment }: { attachment: ChatAttachmentPayload }) {
  const ext = attachmentExtension(attachment);
  if (attachment.sourceLabel === "Google Drive") {
    return <DriveIcon className="h-4 w-4" />;
  }
  if (ext === "pdf") {
    return <PaperIcon className="h-4 w-4" />;
  }
  if (attachmentIsImage(attachment)) {
    return <ImageIcon className="h-4 w-4" />;
  }
  return <FileIcon className="h-4 w-4" />;
}

function MessageAttachmentList({
  attachments,
}: {
  attachments: ChatAttachmentPayload[];
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {attachments.map((attachment, index) => {
        const ext = attachmentExtension(attachment);
        const size = formatAttachmentSize(attachment.size);
        const previewSrc = attachmentIsImage(attachment)
          ? attachmentPreviewSrc(attachment)
          : "";
        const key = `${attachment.name}-${attachment.runId ?? index}`;

        return (
          <div
            key={key}
            className={`max-w-[240px] overflow-hidden rounded-xl border text-left shadow-sm ${attachmentTone(
              attachment
            )}`}
          >
            {previewSrc ? (
              <img
                src={previewSrc}
                alt={attachment.name}
                className="h-28 w-full object-cover"
              />
            ) : null}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-white/70 text-current dark:bg-white/10">
                <AttachmentGlyph attachment={attachment} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">
                  {attachment.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] uppercase tracking-normal opacity-70">
                  {[ext, size, attachment.status].filter(Boolean).join(" | ")}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Shows how much of the repository an answer covered and what it could not do.
 *
 * The server already records both on every repository answer, but nothing
 * displayed them, so the honesty work was invisible: a reader could not tell a
 * complete answer from one based on a handful of retrieved passages.
 */
/** The gaps an answer reported about itself, read back off the message. */
function limitationsFromMetadata(metadata?: Record<string, unknown> | null): string[] {
  if (!metadata || !Array.isArray(metadata.repositoryLimitations)) return [];
  return (metadata.repositoryLimitations as unknown[]).map(String).filter((item) => item.trim());
}

/** Evidence the retrieval looked for and did not find, if it reported any. */
function missingEvidenceNeedsFromMetadata(metadata?: Record<string, unknown> | null): string[] {
  const diagnostics = metadata?.repositoryDiagnostics as { missingEvidenceNeeds?: unknown } | null;
  if (!diagnostics || !Array.isArray(diagnostics.missingEvidenceNeeds)) return [];
  return (diagnostics.missingEvidenceNeeds as unknown[]).map(String).filter((item) => item.trim());
}

/** How many papers the answer actually drew on, for widening suggestions. */
function coveredPaperCount(metadata?: Record<string, unknown> | null): number {
  const coverage = metadata?.repositoryCoverage as { eligiblePapers?: unknown } | null;
  return typeof coverage?.eligiblePapers === "number" ? coverage.eligiblePapers : 0;
}

function AnswerCaveats({ metadata }: { metadata?: Record<string, unknown> | null }) {
  if (!metadata) return null;
  const limitations = Array.isArray(metadata.repositoryLimitations)
    ? (metadata.repositoryLimitations as unknown[]).map(String).filter((item) => item.trim())
    : [];
  const coverage = (metadata.repositoryCoverage ?? null) as
    | { returnedPapers?: number; eligiblePapers?: number; complete?: boolean; scopeLabel?: string }
    | null;
  const hasCoverage =
    coverage && typeof coverage.eligiblePapers === "number" && coverage.eligiblePapers > 0;
  const diagnostics = metadata.repositoryDiagnostics as { cached?: unknown } | null;
  const cached = diagnostics?.cached === true;
  if (!hasCoverage && limitations.length === 0 && !cached) return null;

  return (
    <div className="max-w-[720px] space-y-1 border-l-2 border-slate-200 pl-3 text-xs leading-5 text-slate-600 dark:border-[#242424] dark:text-[#8e8e8e]">
      {hasCoverage ? (
        <p>
          {coverage!.complete
            ? `Covered all ${coverage!.eligiblePapers} paper${coverage!.eligiblePapers === 1 ? "" : "s"} in ${coverage!.scopeLabel ?? "this scope"}.`
            : `Based on ${coverage!.returnedPapers ?? 0} of ${coverage!.eligiblePapers} paper${coverage!.eligiblePapers === 1 ? "" : "s"} in ${coverage!.scopeLabel ?? "this scope"}.`}
        </p>
      ) : null}
      {limitations.map((limitation, index) => (
        <p key={`limitation-${index}`}>{limitation}</p>
      ))}
      {cached ? (
        <p>
          Answered from an earlier identical question in this repository. Ask
          again after adding or re-analysing a paper to get a fresh answer.
        </p>
      ) : null}
    </div>
  );
}

function renderLoadingLabel(
  deepResearchEnabled: boolean,
  chartModeEnabled: boolean,
  activeSession?: DeepResearchSessionRecord | null,
  starting = false
) {
  if (chartModeEnabled) return "Building chart…";
  if (!deepResearchEnabled) return "Generating answer…";
  if (starting) return "Starting deep research…";
  if (activeSession?.status === "planned") return "Planning deep research…";
  if (activeSession?.status === "waiting_on_analysis") return "Waiting for folder analysis…";
  return "Running deep research…";
}

function buildResearchTitle(
  thread?: WorkspaceThreadSummary | null,
  session?: DeepResearchSessionRecord | null
) {
  const source =
    thread?.title?.trim() ||
    session?.plan_summary?.trim() ||
    session?.prompt?.trim() ||
    "Deep research";
  return source.split("\n")[0]?.trim() || "Deep research";
}

const REPORT_BLOCK_SEPARATOR = String.fromCharCode(10, 10);

/**
 * The sources a deep research report cites, numbered as its footnotes are.
 * Each opens the paper in the Library.
 */
function ResearchSources({ sources }: { sources: CitationSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section className="mt-10 border-t border-slate-200 pt-6 dark:border-[#1f1f1f]">
      <h2 className="text-base font-semibold text-slate-900 dark:text-[#ececec]">Sources</h2>
      <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-700 dark:text-[#d4d4d4]">
        {sources.map((source) => (
          <li key={source.paperId} className="flex gap-3">
            <span className="min-w-[1.5rem] flex-none font-semibold text-slate-600 dark:text-[#8e8e8e]">{source.number}.</span>
            <span className="min-w-0">
              {source.href ? (
                <SourceLink href={safeCitationHref(source.href)} className="underline decoration-slate-300 underline-offset-2 hover:text-slate-950 dark:decoration-[#444] dark:hover:text-white">
                  {source.title}
                </SourceLink>
              ) : (
                source.title
              )}
              {source.year && source.year !== "Unknown" ? (
                <span className="text-slate-600 dark:text-[#8e8e8e]"> ({source.year})</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What the research director chose for this plan: where to look, and whether
 * web search and charts help. Shown on the plan so the reader can Edit before
 * Start instead of setting switches up front.
 */
function ResearchChoices({ session }: { session: DeepResearchSessionRecord }) {
  const policy = session.steps?.find((step) => step.input_payload?.sourcePolicy)?.input_payload?.sourcePolicy;
  if (!policy) return null;
  const selected = session.steps?.find((step) => step.input_payload?.selectedRunIds?.length)?.input_payload?.selectedRunIds?.length ?? 0;
  const scope =
    policy.scope === "attached"
      ? `${selected || "The"} attached paper${selected === 1 ? "" : "s"}`
      : policy.scope === "workspace"
        ? "All your repositories"
        : "This repository";
  const webSearches = policy.allowWeb ? policy.budget?.maxWebSearches ?? 0 : 0;
  const choices = [
    { label: "Looks in", value: scope },
    { label: "Web", value: webSearches > 0 ? `Up to ${webSearches} searches` : "Not needed" },
    { label: "Charts", value: policy.allowCharts ? "Yes" : "Not needed" },
  ];
  return (
    <dl className="mt-4 flex flex-wrap gap-2">
      {choices.map((choice) => (
        <div
          key={choice.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-xs"
        >
          <dt className="text-mute">{choice.label}</dt>
          <dd className="font-medium text-ink">{choice.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What a v2 run looks in and how it went (docs/31): the sub-questions are the
 * steps below, so this says only where it searches and, once finished, what
 * the claim check did.
 */
function ResearchV2Summary({ session, scopeLabel }: { session: DeepResearchSessionRecord; scopeLabel: string }) {
  const gathers = (session.steps ?? []).filter((step) => step.tool_name === "dr2_gather");
  const web = gathers.filter((step) => {
    const sources = (step.input_payload as { question?: { sources?: string } } | undefined)?.question?.sources;
    return sources === "web" || sources === "both";
  }).length;
  const check = (session.steps ?? []).find((step) => step.tool_name === "dr2_check");
  const audit = (check?.output_payload as { audit?: { checked: number; rewritten: number; removed: number }; auditRan?: boolean } | undefined) ?? {};
  const choices = [
    { label: "Looks in", value: scopeLabel },
    { label: "Parts", value: `${gathers.length}` },
    { label: "Web", value: web > 0 ? `For ${web} of ${gathers.length}` : "Not needed" },
    ...(session.status === "completed" && audit.audit
      ? [{
          label: "Checked",
          value: audit.auditRan
            ? `${audit.audit.checked} claims, ${audit.audit.rewritten} corrected, ${audit.audit.removed} removed`
            : "Citations and numbers",
        }]
      : []),
  ];
  return (
    <dl className="mt-4 flex flex-wrap gap-2">
      {choices.map((choice) => (
        <div key={choice.label} className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-xs">
          <dt className="text-mute">{choice.label}</dt>
          <dd className="font-medium text-ink">{choice.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function splitReportBlocks(report?: string | null) {
  return String(report || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

function readStringArray(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function extractStepRawRecord(step: DeepResearchStepRecord) {
  return asRecord(step.output_payload?.raw);
}

function extractStepDiagnostics(step: DeepResearchStepRecord) {
  const raw = extractStepRawRecord(step);
  return [
    asRecord(step.output_payload?.diagnostics),
    asRecord(raw?.diagnostics),
    asRecord(raw?.verification),
  ].filter(Boolean) as Record<string, unknown>[];
}

function extractStepWarnings(step: DeepResearchStepRecord) {
  return uniqueStrings(
    extractStepDiagnostics(step).flatMap((diagnostics) => [
      ...readStringArray(diagnostics, "verification_warnings"),
      ...readStringArray(diagnostics, "warnings"),
    ])
  );
}

function extractStepUnresolvedSections(step: DeepResearchStepRecord) {
  return uniqueStrings(
    extractStepDiagnostics(step).flatMap((diagnostics) => [
      ...readStringArray(diagnostics, "unresolved_sections"),
      ...readStringArray(diagnostics, "missing_sections"),
    ])
  );
}

function extractStepEvidenceItems(step: DeepResearchStepRecord) {
  const raw = extractStepRawRecord(step);
  const rawItems = raw?.evidenceItems;
  if (!Array.isArray(rawItems)) return [] as DeepResearchEvidenceItem[];
  return rawItems.filter((item): item is DeepResearchEvidenceItem => {
    const record = asRecord(item);
    return Boolean(record?.title && record?.snippet);
  });
}

function extractStepCitations(step: DeepResearchStepRecord) {
  const raw = extractStepRawRecord(step);
  const outputCitations = step.output_payload?.citations ?? [];
  const rawLedgerValue = raw?.citationLedger;
  const rawLedger = Array.isArray(rawLedgerValue)
    ? (rawLedgerValue as DeepResearchCitationRef[])
    : [];
  return [...outputCitations, ...rawLedger].filter((citation) =>
    Boolean(citation?.source_id || citation?.source_label || citation?.url)
  );
}

function formatResearchPhase(value?: string | null) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildResearchEvidenceSummary(session?: DeepResearchSessionRecord | null) {
  const steps = session?.steps ?? [];
  const citations = steps.flatMap(extractStepCitations);
  const uniqueCitations = new Map<string, DeepResearchCitationRef>();
  citations.forEach((citation) => {
    const key =
      citation.source_id ||
      citation.url ||
      String(citation.paper_id ?? "") ||
      citation.source_label;
    if (key && !uniqueCitations.has(key)) {
      uniqueCitations.set(key, citation);
    }
  });
  const evidenceItems = steps.flatMap(extractStepEvidenceItems);
  const warnings = uniqueStrings(steps.flatMap(extractStepWarnings));
  const unresolvedSections = uniqueStrings(
    steps.flatMap(extractStepUnresolvedSections)
  );
  const partialSteps = steps.filter(
    (step) => step.output_payload?.completion_kind === "partial"
  ).length;
  const sourceTotals = Array.from(uniqueCitations.values()).reduce(
    (summary, citation) => {
      const type = citation.source_type ?? "workspace";
      summary.total += 1;
      if (type === "paper") summary.paper += 1;
      else if (type === "web") summary.web += 1;
      else summary.workspace += 1;
      return summary;
    },
    { total: 0, paper: 0, web: 0, workspace: 0 }
  );

  return {
    sourceTotals,
    evidenceCount: evidenceItems.length,
    supportedEvidenceCount: evidenceItems.filter(
      (item) => item.supports_section
    ).length,
    warnings,
    unresolvedSections,
    partialSteps,
  };
}

function ResearchEvidenceSummary({
  summary,
}: {
  summary: ReturnType<typeof buildResearchEvidenceSummary>;
}) {
  const completionLabel =
    summary.partialSteps > 0 ? `${summary.partialSteps} partial` : "No partial steps";
  const metrics = [
    ["Sources", String(summary.sourceTotals.total)],
    ["Library", String(summary.sourceTotals.paper)],
    [
      "Evidence",
      `${summary.supportedEvidenceCount}/${summary.evidenceCount}`,
    ],
    ["Completion", completionLabel],
  ];
  const visibleWarnings = summary.warnings.slice(0, 3);
  const visibleUnresolved = summary.unresolvedSections.slice(0, 4);
  const hasVisibleSignal =
    summary.sourceTotals.total > 0 ||
    summary.evidenceCount > 0 ||
    summary.partialSteps > 0 ||
    visibleWarnings.length > 0 ||
    visibleUnresolved.length > 0;

  if (!hasVisibleSignal) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]">
      <div className="grid gap-3 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] font-medium uppercase tracking-normal text-slate-600 dark:text-[#8e8e8e]">
              {label}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-[#ececec]">
              {value}
            </p>
          </div>
        ))}
      </div>
      {visibleWarnings.length > 0 || visibleUnresolved.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {visibleWarnings.map((warning) => (
            <span
              key={`warning-${warning}`}
              className="rounded-full border border-amber-300/50 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
            >
              {warning}
            </span>
          ))}
          {visibleUnresolved.map((section) => (
            <span
              key={`unresolved-${section}`}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]"
            >
              Missing: {section}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildResearchProgress(session?: DeepResearchSessionRecord | null) {
  const steps = session?.steps ?? [];
  const completedSteps = steps.filter(
    (step) =>
      step.status === "completed" &&
      step.output_payload?.result_kind !== "blocked"
  ).length;
  const obsoleteSteps = steps.filter(
    (step) => step.output_payload?.result_kind === "obsolete"
  ).length;
  const failedSteps = steps.filter((step) => step.status === "failed").length;
  const processingStep = steps.find((step) => step.status === "processing");
  const waitingStep = steps.find(
    (step) =>
      step.status === "waiting" ||
      step.output_payload?.result_kind === "blocked"
  );
  const activeStep = processingStep ?? waitingStep ?? null;
  const totalSteps = steps.length;
  const resolvedSteps = completedSteps + obsoleteSteps;
  const baseRatio = totalSteps > 0 ? resolvedSteps / totalSteps : 0;

  let ratio = baseRatio;
  if (session?.status === "queued" || session?.status === "waiting_on_analysis") {
    ratio = Math.max(ratio, 0.08);
  }
  if (session?.status === "processing" && activeStep) {
    ratio = Math.min(0.94, baseRatio + 0.16);
  }
  if (session?.status === "completed") {
    ratio = 1;
  }

  let detail = "Plan ready to review before starting.";
  if (session?.status === "queued") {
    detail = "Queued and ready to start the research run.";
  } else if (session?.status === "waiting_on_analysis") {
    detail =
      session.pending_run_count > 0
        ? `Analyzing ${session.pending_run_count} pending file${session.pending_run_count === 1 ? "" : "s"} before research continues.`
        : "Waiting for folder analysis before research continues.";
  } else if (session?.status === "processing") {
    detail =
      activeStep?.output_payload?.summary?.trim() ||
      activeStep?.description?.trim() ||
      activeStep?.title?.trim() ||
      "Working through the deep research plan.";
  } else if (session?.status === "completed") {
    detail =
      session.steps?.find((step) => step.output_payload?.completion_kind === "partial")
        ?.output_payload?.summary?.trim() ||
      "Research completed and the final report is ready.";
  } else if (session?.status === "failed") {
    detail = session.last_error?.trim() || "Research stopped before completion.";
  }

  return {
    steps,
    totalSteps,
    completedSteps: resolvedSteps,
    failedSteps,
    activeStep,
    ratio,
    detail,
  };
}

export default function ChatClient() {
  const { session, user } = useAuth();
  const {
    folders,
    allFolders,
    allProjects,
    currentProject,
    selectedProjectId,
    selectedYears,
    selectedTracks,
    searchQuery,
    startAnalysisSession,
    refreshFolders,
  } = useWorkspaceProfile();
  // Starts on the open repository: starting on "all" asked for a summary of
  // every repository first, then this one's (docs/32, 3.2).
  const [chatScopeProjectId, setChatScopeProjectId] = useState<string>(() => currentProject?.id ?? "all");
  const [chatScopeFolderId, setChatScopeFolderId] = useState<string>("all");
  // A chat opened inside a repository asks that repository until the reader
  // picks another scope. It used to start on every repository in the account,
  // so "Ask about these papers" on a repository's Home searched papers from
  // other repositories as well.
  const scopeChosenRef = useRef(false);
  useEffect(() => {
    if (scopeChosenRef.current || !currentProject?.id) return;
    setChatScopeProjectId(currentProject.id);
    setChatScopeFolderId("all");
  }, [currentProject?.id]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CHAT_MODEL);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [chartModeEnabled, setChartModeEnabled] = useState(false);
  const [researchSourcePolicy, setResearchSourcePolicy] =
    useState<DeepResearchSourcePolicy>(DEFAULT_RESEARCH_SOURCE_POLICY);
  const [chartSuggestionDismissedFor, setChartSuggestionDismissedFor] = useState("");
  const [parameterMenuOpen, setParameterMenuOpen] = useState(false);
  const [chatParameters, setChatParameters] = useState<ChatGenerationParameters>(
    DEFAULT_CHAT_PARAMETERS
  );
  // The scope's years come with its summary. The whole dashboard dataset used
  // to be fetched on every chat page for this list alone (docs/32, 3.2).
  const [scopeYears, setScopeYears] = useState<string[]>([]);
  const allYears = scopeYears;
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<WorkspaceThreadSummary[]>([]);
  // Conversations arrive a page at a time; older ones load on request.
  const [threadsHasMore, setThreadsHasMore] = useState(false);
  const [olderThreadsLoading, setOlderThreadsLoading] = useState(false);
  // A long conversation opens on its newest messages; earlier ones load on request.
  const [hasEarlierMessages, setHasEarlierMessages] = useState(false);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const oldestMessageAtRef = useRef<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<WorkspaceThreadSummary | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [deepSession, setDeepSession] = useState<DeepResearchSessionRecord | null>(null);
  const [libraryRuns, setLibraryRuns] = useState<IngestionRunRow[]>([]);
  // What a question in the current scope would actually search. The composer
  // used to show a hardcoded zero, so the number a reader saw before sending
  // never matched the number the answer reported afterwards.
  const [scopeSummary, setScopeSummary] = useState<{
    scopeLabel: string;
    eligiblePaperCount: number;
    examples: ExampleQuestion[];
  } | null>(null);
  const [selectedLibraryRuns, setSelectedLibraryRuns] = useState<IngestionRunRow[]>([]);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ChatProgressUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"root" | "scope">("root");
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [reportFullViewOpen, setReportFullViewOpen] = useState(false);
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen && !conversationMenuOpen && !threadMenuId) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setMenuOpen(false);
      setConversationMenuOpen(false);
      setThreadMenuId(null);
    };
    // On the document, so it runs before a dialog layer's handler (on the
    // window): Escape in a chat's menu inside the chat drawer closes the menu.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, conversationMenuOpen, threadMenuId]);
  // The full report is a dialog layer (docs/32, 2.9): a paper opened from it
  // is the layer on top, so Escape closes the paper and leaves the report.
  const reportViewRef = useRef<HTMLDivElement>(null);
  useDialogLayer(reportFullViewOpen, reportViewRef, () => setReportFullViewOpen(false));
  // Below the large breakpoint the conversation list opens as a drawer, with
  // the same Pin, Rename, Delete and older chats as the sidebar. Phones and
  // tablets had only the search dialog, which could open a chat but do
  // nothing else with it (docs/32, 2.11, CHAT-8).
  const [chatListOpen, setChatListOpen] = useState(false);
  const chatListRef = useRef<HTMLElement>(null);
  const chatListIsOverlay = useIsNarrow(1024);
  const chatListDrawer = chatListOpen && chatListIsOverlay;
  useDialogLayer(chatListDrawer, chatListRef, () => setChatListOpen(false));
  useEffect(() => {
    if (!chatListIsOverlay) setChatListOpen(false);
  }, [chatListIsOverlay]);
  const sidebarCompact = sidebarCollapsed && !chatListDrawer;
  // Rename and delete ask in the page: window.prompt and window.confirm are
  // ignored by some in-app browsers, so neither could be done there.
  const [threadDialog, setThreadDialog] = useState<{ kind: "rename" | "delete"; thread: WorkspaceThreadSummary } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [threadDialogBusy, setThreadDialogBusy] = useState(false);
  // The analysis tray stands above the composer instead of over it.
  const composerAreaRef = useRef<HTMLDivElement>(null);
  useComposerOffset(composerAreaRef);
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchDetails, setChatSearchDetails] = useState<ChatThreadDetail[]>([]);
  const [chatSearchLoading, setChatSearchLoading] = useState(false);
  const [chatSearchError, setChatSearchError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  /** The transcript's scroll box, and whether the reader is at its bottom (docs/32, 2.7). */
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  /** Set when the reader sends a message or opens a conversation: go to the newest. */
  const forceScrollRef = useRef(true);
  /** Set before earlier messages are put on top, to keep the reader's place. */
  const preservedScrollRef = useRef<{ height: number; top: number } | null>(null);
  /** The last research session state shown, so a poll that changed nothing re-renders nothing. */
  const deepSessionSignatureRef = useRef("");
  const abortControllerRef = useRef<AbortController | null>(null);
  // Names the in-flight answer so Stop can tell the server which one to drop.
  const requestIdRef = useRef<string | null>(null);
  /** Which conversation the transcript on screen belongs to. */
  const loadedThreadIdRef = useRef<string | null>(null);
  const repositoryJobPollsRef = useRef(
    new Map<string, { controller: AbortController; threadId: string }>()
  );
  const parameterMenuRef = useRef<HTMLDivElement | null>(null);
  // Every menu here closes on a press anywhere outside it, not only on its own button.
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const conversationMenuRef = useRef<HTMLDivElement | null>(null);
  const threadMenuRef = useRef<HTMLDivElement | null>(null);
  useDismiss(menuOpen, () => setMenuOpen(false), toolMenuRef);
  useDismiss(conversationMenuOpen, () => setConversationMenuOpen(false), conversationMenuRef);
  useDismiss(Boolean(threadMenuId), () => setThreadMenuId(null), threadMenuRef);
  const editComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const scopeTransferHandledRef = useRef(false);

  const canPersist = Boolean(user && session?.access_token);
  const effectiveSelectedYears = selectedYears.length > 0 ? selectedYears : allYears;
  const effectiveSelectedTracks =
    selectedTracks.length > 0 ? selectedTracks : [...TRACK_COLS];
  const requestHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }, [session?.access_token]);
  const sortedThreads = useMemo(
    () => sortThreads(threads, pinnedThreadIds),
    [pinnedThreadIds, threads]
  );
  const chatSearchResults = useMemo(
    () => buildChatSearchResults(chatSearchDetails, chatSearchQuery),
    [chatSearchDetails, chatSearchQuery]
  );
  const selectedRunIds = useMemo(
    () => selectedLibraryRuns.map((run) => run.id),
    [selectedLibraryRuns]
  );
  const effectiveResearchSourcePolicy = useMemo<DeepResearchSourcePolicy>(
    () => ({
      ...researchSourcePolicy,
      scope:
        selectedRunIds.length > 0
          ? "attached"
          : chatScopeProjectId === "all" && chatScopeFolderId === "all"
            ? "workspace"
          : researchSourcePolicy.scope === "workspace"
            ? "workspace"
            : "project",
      includeAttached: true,
      includeCurrentScope: true,
      includeWorkspace:
        researchSourcePolicy.includeWorkspace ||
        (chatScopeProjectId === "all" && chatScopeFolderId === "all"),
      agentDirected: true,
      // Permission, not a choice: the research director decides whether web
      // search and charts help this question, within this budget.
      allowWeb: true,
      allowCharts: true,
      allowCode: false,
      budget: { ...STRICT_RESEARCH_BUDGET },
    }),
    [chatScopeFolderId, chatScopeProjectId, researchSourcePolicy, selectedRunIds.length]
  );
  const selectedAttachments = useMemo(
    () =>
      selectedLibraryRuns.map((run) => ({
        name: runTitleOf(run),
        type: run.mime_type || runExtOf(run),
        size: run.file_size_bytes ?? undefined,
        runId: run.id,
        status: run.status,
        sourceLabel: runSourceLabel(run),
        extension: runExtOf(run),
      })),
    [selectedLibraryRuns]
  );
  const activeFolderLabel = useMemo(() => {
    if (selectedRunIds.length > 0) {
      return `${selectedRunIds.length} selected paper${selectedRunIds.length === 1 ? "" : "s"}`;
    }
    if (chatScopeFolderId !== "all") {
      return allFolders.find((folder) => folder.id === chatScopeFolderId)?.name ?? "Selected folder";
    }
    if (chatScopeProjectId !== "all") {
      const project = allProjects.find((item) => item.id === chatScopeProjectId);
      return project ? `${project.name} repository` : "Selected repository";
    }
    return "All repositories";
  }, [allFolders, allProjects, chatScopeFolderId, chatScopeProjectId, selectedRunIds.length]);
  const filteredLibraryRuns = useMemo(() => {
    const needle = libraryQuery.trim().toLowerCase();
    return libraryRuns.filter((run) => {
      if (run.trashed_at) return false;
      if (!needle) return true;
      return [runTitleOf(run), run.source_path, runExtOf(run), runSourceLabel(run)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [libraryQuery, libraryRuns]);
  const pageTitle = activeThread?.title ?? "Chat";
  const researchTitle = useMemo(
    () => buildResearchTitle(activeThread, deepSession),
    [activeThread, deepSession]
  );
  // A v2 run's report is a message in the conversation, drawn like an answer
  // with its sources, and each new question keeps the reports before it.
  const researchV2 = useMemo(() => isV2Session(deepSession), [deepSession]);
  const [researchStarting, setResearchStarting] = useState(false);
  const researchScopeLabel = useMemo(() => {
    const write = deepSession?.steps?.find((step) => step.tool_name === "dr2_write");
    const scope = (write?.input_payload as { scope?: { kind?: string; folderId?: string | null; runIds?: string[] } } | undefined)?.scope;
    if (!scope) return "This repository";
    if (scope.kind === "selected_papers") return `${scope.runIds?.length ?? 0} attached paper${scope.runIds?.length === 1 ? "" : "s"}`;
    if (scope.kind === "folder" && scope.folderId) return buildFolderLabel(scope.folderId, folders);
    if (scope.kind === "all_projects") return "All your repositories";
    return "This repository";
  }, [deepSession, folders]);
  const researchReport = useMemo(
    () => {
      if (researchV2) return "";
      const sessionReport = deepSession?.final_report?.trim();
      if (sessionReport) {
        return sessionReport;
      }
      if (deepSession && deepSession.status !== "completed") {
        return "";
      }
      return (
        [...messages]
          .reverse()
          .find((message) => message.kind === "deep_research_report")
          ?.content?.trim() || ""
      );
    },
    [deepSession, messages, researchV2]
  );
  // The report is markdown with "(Title, year)" citations, drawn the way chat
  // answers are: headings and lists as such, citations as numbered footnotes.
  // It used to be printed as plain text, "#" and "**" included.
  const researchMarked = useMemo(() => {
    const reportMessage = [...messages].reverse().find((message) => message.kind === "deep_research_report");
    return markCitations(
      researchReport,
      (reportMessage?.citations ?? [])
        .filter((citation) => citation.paperId && citation.sourceType !== "web")
        .map((citation) => ({
          paperId: citationPaperId(citation),
          title: String(citation.title ?? ""),
          year: String(citation.year ?? ""),
          href: String(citation.href ?? ""),
        }))
    );
  }, [messages, researchReport]);
  // An older (v1) report is drawn as its own card; it copies and downloads
  // with every source, web pages included (docs/32, 4.2).
  const researchReportCitations = useMemo(
    () =>
      ([...messages].reverse().find((message) => message.kind === "deep_research_report")?.citations ?? []).map((citation) => ({
        ...citation,
        paperId: String(citation.paperId),
      })),
    [messages]
  );
  const researchBlocks = useMemo(
    () => splitReportBlocks(researchMarked.text),
    [researchMarked.text]
  );
  const visibleMessages = useMemo(
    () =>
      researchReport
        ? messages.filter((message) => message.kind !== "deep_research_report")
        : messages,
    [messages, researchReport]
  );
  const activeKnowledgeScope = useMemo<KnowledgeScope>(() => {
    if (selectedRunIds.length > 0) {
      return {
        kind: "selected_papers",
        runIds: selectedRunIds,
      };
    }
    if (chatScopeFolderId !== "all") {
      const selectedFolder = allFolders.find((folder) => folder.id === chatScopeFolderId);
      return {
        kind: "folder",
        projectId:
          selectedFolder?.project_id ??
          (chatScopeProjectId !== "all" ? chatScopeProjectId : undefined),
        folderId: chatScopeFolderId,
      };
    }
    if (chatScopeProjectId !== "all") {
      return { kind: "project", projectId: chatScopeProjectId };
    }
    return { kind: "all_projects" };
  }, [allFolders, chatScopeFolderId, chatScopeProjectId, selectedRunIds]);
  const activeScopeSnapshot = useMemo<KnowledgeScopeSnapshot>(() => {
    const selectedFolder = allFolders.find((folder) => folder.id === activeKnowledgeScope.folderId) ?? null;
    const selectedProject = allProjects.find((project) => project.id === activeKnowledgeScope.projectId) ?? null;
    const label = activeKnowledgeScope.kind === "selected_papers"
      ? `${selectedRunIds.length} selected paper${selectedRunIds.length === 1 ? "" : "s"}`
      : activeKnowledgeScope.kind === "folder"
        ? selectedFolder?.name ?? "Selected folder"
        : activeKnowledgeScope.kind === "project"
          ? `${selectedProject?.name ?? "Selected project"} repository`
          : "All repositories";
    return {
      kind: activeKnowledgeScope.kind,
      label,
      projectId: activeKnowledgeScope.projectId ?? null,
      projectName: selectedProject?.name ?? null,
      folderId: activeKnowledgeScope.folderId ?? null,
      folderName: selectedFolder?.name ?? null,
      selectedRunCount: activeKnowledgeScope.runIds?.length ?? 0,
      eligiblePaperCount: 0,
    };
  }, [activeKnowledgeScope, allFolders, allProjects, selectedRunIds.length]);
  useEffect(() => {
    if (!session?.access_token) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (activeKnowledgeScope.projectId) params.set("projectId", activeKnowledgeScope.projectId);
    if (activeKnowledgeScope.folderId) params.set("folderId", activeKnowledgeScope.folderId);
    void fetch(chatEndpoint(`/api/chat/scope-summary?${params.toString()}`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload || typeof payload.eligiblePaperCount !== "number") return;
        setScopeSummary({
          scopeLabel: String(payload.scopeLabel ?? ""),
          eligiblePaperCount: payload.eligiblePaperCount,
          examples: Array.isArray(payload.examples) ? payload.examples : [],
        });
        setScopeYears(Array.isArray(payload.years) ? payload.years.map(String) : []);
      })
      .catch(() => {
        // An unreadable scope is not worth an error on an empty page; the
        // composer falls back to naming the scope without a count.
      });
    return () => controller.abort();
  }, [activeKnowledgeScope.projectId, activeKnowledgeScope.folderId, session?.access_token]);

  const conversationSources = useMemo(
    () => dedupeConversationSources(visibleMessages.flatMap((message) => message.citations)),
    [visibleMessages]
  );
  const researchProgress = useMemo(
    () => buildResearchProgress(deepSession),
    [deepSession]
  );
  const researchEvidenceSummary = useMemo(
    () => buildResearchEvidenceSummary(deepSession),
    [deepSession]
  );
  const hasContent = visibleMessages.length > 0 || Boolean(deepSession);
  const trimmedDraft = draft.trim();
  const chartSuggestionVisible = Boolean(
    trimmedDraft &&
      CHART_INTENT_PATTERN.test(trimmedDraft) &&
      !chartModeEnabled &&
      !deepResearchEnabled &&
      chartSuggestionDismissedFor !== trimmedDraft
  );

  const resizeComposer = useCallback(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawPinned = window.localStorage.getItem(PINNED_THREADS_STORAGE_KEY);
      if (rawPinned) {
        const parsed = JSON.parse(rawPinned) as string[];
        if (Array.isArray(parsed)) setPinnedThreadIds(parsed.filter(Boolean));
      }
      setSelectedModel(
        normalizeStoredModel(window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY))
      );
      const rawParams = window.localStorage.getItem(CHAT_PARAMETERS_STORAGE_KEY);
      if (rawParams) {
        const parsed = JSON.parse(rawParams) as Partial<ChatGenerationParameters>;
        setChatParameters({
          ...DEFAULT_CHAT_PARAMETERS,
          ...parsed,
        });
      }
    } catch {
      setPinnedThreadIds([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      PINNED_THREADS_STORAGE_KEY,
      JSON.stringify(pinnedThreadIds)
    );
  }, [pinnedThreadIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (!menuOpen) setMenuView("root");
  }, [menuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CHAT_PARAMETERS_STORAGE_KEY,
      JSON.stringify(chatParameters)
    );
  }, [chatParameters]);

  useEffect(() => {
    if (!parameterMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!parameterMenuRef.current?.contains(target)) {
        setParameterMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [parameterMenuOpen]);

  useEffect(() => {
    if (deepResearchEnabled) {
      setParameterMenuOpen(false);
      setChartModeEnabled(false);
    }
  }, [deepResearchEnabled]);

  useEffect(() => {
    if (chartModeEnabled) {
      setParameterMenuOpen(false);
    }
  }, [chartModeEnabled]);

  useEffect(() => {
    resizeComposer();
  }, [draft, resizeComposer]);

  // Earlier messages go on top without moving what the reader is looking at.
  useLayoutEffect(() => {
    const preserved = preservedScrollRef.current;
    const box = scrollContainerRef.current;
    if (!preserved || !box) return;
    preservedScrollRef.current = null;
    box.scrollTop = preserved.top + (box.scrollHeight - preserved.height);
  }, [messages]);

  // Follow new content only for a reader already at the bottom, or one who
  // just asked something: it used to pull a reader who had scrolled up back
  // down on every update, including every five-second research poll.
  useEffect(() => {
    if (!forceScrollRef.current && !nearBottomRef.current) return;
    forceScrollRef.current = false;
    // The transcript scrolls itself. scrollIntoView also scrolls every box
    // around it, the page's overflow-hidden frame included.
    const box = scrollContainerRef.current;
    box?.scrollTo({
      top: box.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [deepSession?.status, loading, messages]);

  // A screen reader hears when an answer arrives: the only live region was
  // the "thinking" line, which disappeared with the answer (docs/32, 2.11, CHAT-10).
  const [answerAnnouncement, setAnswerAnnouncement] = useState("");
  // "" announces the next answer; null (set when a conversation is opened)
  // skips the transcript that arrives with it.
  const announcedAnswerRef = useRef<string | null>("");
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (loading || !last || last.role !== "assistant" || last.id.startsWith("local-")) return;
    if (announcedAnswerRef.current === null) {
      // A conversation that is opened is not an answer arriving.
      announcedAnswerRef.current = last.id;
      return;
    }
    if (announcedAnswerRef.current === last.id) return;
    announcedAnswerRef.current = last.id;
    const sources = last.citations.length;
    setAnswerAnnouncement(`Answer ready${sources ? `, ${sources} source${sources === 1 ? "" : "s"}` : ""}.`);
  }, [loading, messages]);

  const handleTranscriptScroll = useCallback(() => {
    const box = scrollContainerRef.current;
    if (!box) return;
    nearBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  useEffect(() => {
    if (deepSession?.status !== "completed") {
      setReportFullViewOpen(false);
    }
  }, [deepSession?.id, deepSession?.status]);

  const resetChat = useCallback(
    (mode: ChatMode = deepResearchEnabled ? "deep_research" : "normal") => {
      setActiveThreadId(null);
      setActiveThread(null);
      loadedThreadIdRef.current = null;
      setMessages([]);
      setHasEarlierMessages(false);
      oldestMessageAtRef.current = null;
      setDeepSession(null);
      setSelectedLibraryRuns([]);
      setError(null);
      setThreadMenuId(null);
      setChatListOpen(false);
      setReportFullViewOpen(false);
      setDeepResearchEnabled(mode === "deep_research");
      setChartModeEnabled(false);
    },
    [deepResearchEnabled]
  );

  const applyPayload = useCallback((payload: ChatPayload) => {
    if (payload.thread) {
      // The answer brings its conversation's transcript: that conversation is
      // loaded, so opening it must not blank the page and fetch it again
      // (docs/32, 2.11, CHAT-6).
      if (payload.messages) loadedThreadIdRef.current = payload.thread.id;
      setActiveThread(payload.thread);
      setActiveThreadId(payload.thread.id);
      setDeepResearchEnabled(payload.thread.mode === "deep_research");
      if (payload.thread.mode === "deep_research") {
        setChartModeEnabled(false);
      }
      setThreads((current) => [
        payload.thread!,
        ...current.filter((item) => item.id !== payload.thread!.id),
      ]);
    }
    if (payload.messages) {
      setMessages(
        payload.messages
          .filter((message) => message.message_kind !== "deep_research_plan")
          .map(mapMessage)
      );
    }
    deepSessionSignatureRef.current = JSON.stringify(payload.deepResearchSession ?? null);
    setDeepSession(payload.deepResearchSession ?? null);
    if (payload.thread?.mode === "deep_research") {
      setChatScopeFolderId(payload.deepResearchSession?.folder_id ?? "all");
    }
  }, []);

  const refreshThreads = useCallback(
    async (preferredThreadId?: string | null) => {
      if (!canPersist || !session?.access_token) {
        setThreads([]);
        return;
      }
      setThreadsLoading(true);
      try {
        const response = await fetch("/api/chat/threads?limit=50", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await response.json()) as {
          threads?: WorkspaceThreadSummary[];
          hasMore?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load chat history.");
        }
        const nextThreads = payload.threads ?? [];
        setThreads(nextThreads);
        setThreadsHasMore(Boolean(payload.hasMore));
        setActiveThreadId((current) =>
          preferredThreadId ??
          (current && nextThreads.some((item) => item.id === current) ? current : null)
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load chat history."
        );
      } finally {
        setThreadsLoading(false);
      }
    },
    [canPersist, session?.access_token]
  );

  const loadThreadDetail = useCallback(
    async (threadId: string, options: { background?: boolean } = {}) => {
      if (!canPersist || !session?.access_token) return;
      // Clicking a conversation marks it active in the sidebar immediately, but
      // the transcript was only replaced once the fetch returned - so for the
      // length of the round trip the reader saw one conversation's messages
      // sitting under another one's name, and on failure they stayed there
      // under an error about a thread they were no longer looking at.
      // Only on an actual switch: reloading the same thread after sending a
      // message must not blank the transcript the reader is reading.
      if (loadedThreadIdRef.current !== threadId) {
        loadedThreadIdRef.current = threadId;
        forceScrollRef.current = true;
        announcedAnswerRef.current = null;
        deepSessionSignatureRef.current = "";
        setMessages([]);
        setDeepSession(null);
      }
      // A progress poll refreshes quietly: it used to flash the loading
      // spinner and jump the page to the bottom every five seconds.
      if (!options.background) setDetailLoading(true);
      try {
        const response = await fetch(`/api/chat/threads/${threadId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await response.json()) as ChatThreadDetail & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load chat thread.");
        }
        if (loadedThreadIdRef.current !== threadId) return;
        const latest = (payload.messages ?? [])
          .filter((message) => message.message_kind !== "deep_research_plan")
          .map(mapMessage);
        const nextSession = payload.deepResearchSession ?? null;
        const sessionSignature = JSON.stringify(nextSession);
        if (options.background) {
          // A progress poll brings the latest page only. It used to replace the
          // transcript with that page, dropping the messages "Load earlier"
          // had added, and to reset what could still be loaded.
          setMessages((current) => mergeLatestMessages(current, latest));
          if (sessionSignature !== deepSessionSignatureRef.current) {
            deepSessionSignatureRef.current = sessionSignature;
            setDeepSession(nextSession);
          }
        } else {
          setActiveThread(payload.thread);
          setDeepResearchEnabled(payload.thread.mode === "deep_research");
          setHasEarlierMessages(Boolean(payload.hasEarlierMessages));
          oldestMessageAtRef.current = payload.messages?.[0]?.created_at ?? null;
          setMessages(latest);
          deepSessionSignatureRef.current = sessionSignature;
          setDeepSession(nextSession);
        }
        if (payload.thread.mode === "deep_research") {
          setChatScopeFolderId(payload.deepResearchSession?.folder_id ?? "all");
        } else if (!options.background) {
          // A conversation reopens in the scope it was asked in: the last
          // question's repository, folder or papers. It used to reopen in
          // whatever scope was current (docs/32, 2.11, CHAT-9).
          const scope = lastQuestionScope(payload.messages ?? []);
          if (scope?.projectId) {
            scopeChosenRef.current = true;
            setChatScopeProjectId(scope.projectId);
            setChatScopeFolderId(scope.kind === "folder" && scope.folderId ? scope.folderId : "all");
            setSelectedLibraryRuns([]);
            if (scope.kind === "selected_papers" && scope.runIds?.length && session?.access_token) {
              const wanted = new Set(scope.runIds);
              void fetch(`/api/workspace/library?projectId=${encodeURIComponent(scope.projectId)}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              })
                .then(async (response) => (response.ok ? ((await response.json()) as { runs?: IngestionRunRow[] }).runs ?? [] : []))
                .then((rows) => {
                  if (loadedThreadIdRef.current !== threadId) return;
                  setLibraryRuns(rows);
                  setSelectedLibraryRuns(rows.filter((run) => wanted.has(run.id) && hasUsableAnalysis(run)));
                })
                .catch(() => undefined);
            }
          }
        }
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Failed to load chat thread."
        );
      } finally {
        if (!options.background) setDetailLoading(false);
      }
    },
    [canPersist, session?.access_token]
  );

  const loadChatSearchDetails = useCallback(
    async (query: string) => {
      if (!canPersist || !session?.access_token) {
        setChatSearchDetails([]);
        return;
      }
      const trimmed = query.trim();
      if (!trimmed) {
        setChatSearchError(null);
        setChatSearchDetails(sortedThreads.map((thread) => ({ thread, messages: [] })));
        return;
      }
      setChatSearchLoading(true);
      setChatSearchError(null);
      try {
        const response = await fetch(`/api/chat/threads?q=${encodeURIComponent(trimmed)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await response.json()) as { results?: ChatThreadDetail[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Failed to search chat history.");
        setChatSearchDetails(payload.results ?? []);
      } catch (nextError) {
        setChatSearchError(nextError instanceof Error ? nextError.message : "Failed to search chat history.");
      } finally {
        setChatSearchLoading(false);
      }
    },
    [canPersist, session?.access_token, sortedThreads]
  );

  const loadOlderThreads = useCallback(async () => {
    const oldest = threads[threads.length - 1];
    if (!oldest?.updated_at || !session?.access_token) return;
    setOlderThreadsLoading(true);
    try {
      const response = await fetch(
        `/api/chat/threads?limit=50&before=${encodeURIComponent(oldest.updated_at)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const payload = (await response.json()) as { threads?: WorkspaceThreadSummary[]; hasMore?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load older chats.");
      setThreads((current) => {
        const known = new Set(current.map((thread) => thread.id));
        return [...current, ...(payload.threads ?? []).filter((thread) => !known.has(thread.id))];
      });
      setThreadsHasMore(Boolean(payload.hasMore));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load older chats.");
    } finally {
      setOlderThreadsLoading(false);
    }
  }, [session?.access_token, threads]);

  const [exportingConversation, setExportingConversation] = useState(false);
  // The whole conversation, every page of it, with sources numbered once
  // across it (docs/32, 4.2). A guest's conversation is only what is on screen.
  const exportConversation = useCallback(async () => {
    setExportingConversation(true);
    try {
      const threadId = activeThreadId;
      const messages =
        canPersist && threadId && session?.access_token
          ? await fetchWholeConversation(threadId, session.access_token)
          : visibleMessages;
      const markdown = conversationMarkdown({ title: pageTitle, messages, exportedAt: new Date() });
      downloadMarkdown(markdownFileName(pageTitle, "papertrend-chat"), markdown);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "The conversation couldn't be exported.");
    } finally {
      setExportingConversation(false);
    }
  }, [activeThreadId, canPersist, pageTitle, session?.access_token, visibleMessages]);

  const loadEarlierMessages = useCallback(async () => {
    const threadId = activeThreadId;
    const before = oldestMessageAtRef.current;
    if (!threadId || !before || !session?.access_token) return;
    setEarlierLoading(true);
    try {
      const response = await fetch(`/api/chat/threads/${threadId}?before=${encodeURIComponent(before)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await response.json()) as ChatThreadDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load earlier messages.");
      if (loadedThreadIdRef.current !== threadId) return;
      oldestMessageAtRef.current = payload.messages?.[0]?.created_at ?? before;
      setHasEarlierMessages(Boolean(payload.hasEarlierMessages));
      const earlier = (payload.messages ?? [])
        .filter((message) => message.message_kind !== "deep_research_plan")
        .map(mapMessage);
      const box = scrollContainerRef.current;
      if (box) preservedScrollRef.current = { height: box.scrollHeight, top: box.scrollTop };
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...earlier.filter((message) => !known.has(message.id)), ...current];
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load earlier messages.");
    } finally {
      setEarlierLoading(false);
    }
  }, [activeThreadId, session?.access_token]);

  const loadLibraryRuns = useCallback(async () => {
    if (!canPersist) {
      setLibraryRuns([]);
      return;
    }

    setLibraryLoading(true);
    try {
      const response = await fetch("/api/workspace/library", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const payload = (await response.json()) as {
        runs?: IngestionRunRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load library files.");
      }
      setLibraryRuns(payload.runs ?? []);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to load library files."
      );
    } finally {
      setLibraryLoading(false);
    }
  }, [canPersist, session?.access_token]);

  useEffect(() => {
    if (!canPersist) {
      setThreads([]);
      setActiveThreadId(null);
      setActiveThread(null);
      setDeepSession(null);
      return;
    }
    void refreshThreads(null);
  }, [canPersist, refreshThreads]);

  useEffect(() => {
    if (activeThreadId && canPersist) {
      void loadThreadDetail(activeThreadId);
    }
  }, [activeThreadId, canPersist, loadThreadDetail]);

  // Keyed on whether research is running, not on the session object: a new
  // object on every poll used to tear the timer down and set it up again.
  const deepSessionRunning = sessionActive(deepSession);
  useEffect(() => {
    if (!canPersist || !activeThreadId || !deepSessionRunning) return;
    const timer = window.setInterval(() => {
      void loadThreadDetail(activeThreadId, { background: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, canPersist, deepSessionRunning, loadThreadDetail]);

  useEffect(() => {
    if (!showLibraryPicker) return;
    void loadLibraryRuns();
  }, [loadLibraryRuns, showLibraryPicker]);

  useEffect(() => {
    if (!canPersist || scopeTransferHandledRef.current) return;
    scopeTransferHandledRef.current = true;
    const raw = window.localStorage.getItem(CHAT_SCOPE_TRANSFER_STORAGE_KEY);
    if (!raw) return;
    window.localStorage.removeItem(CHAT_SCOPE_TRANSFER_STORAGE_KEY);
    try {
      // Papers come by run (the semantic map) or by paper (a dashboard drilldown).
      const transfer = readChatScopeTransfer(raw);
      if (!transfer) return;
      void fetch(`/api/workspace/library?projectId=${encodeURIComponent(transfer.projectId)}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
        .then(async (response) => {
          const payload = await response.json() as { runs?: IngestionRunRow[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Failed to transfer papers to chat.");
          const rows = payload.runs ?? [];
          setLibraryRuns(rows);
          setSelectedLibraryRuns(runsInTransfer(rows, transfer).filter((run) => hasUsableAnalysis(run)));
          scopeChosenRef.current = true;
          setChatScopeProjectId(transfer.projectId);
          setChatScopeFolderId("all");
          if (transfer.prompt?.trim()) setDraft(transfer.prompt.trim());
        })
        .catch((transferError) => setError(transferError instanceof Error ? transferError.message : "Failed to transfer papers to chat."));
    } catch {
      // Ignore malformed or stale handoff data.
    }
  }, [canPersist, session?.access_token]);

  useEffect(() => {
    // Home's "Ask about these papers" links here with ?q=. The question goes
    // into the composer rather than being sent, so the reader can edit it and
    // pick a mode first; the parameter is then dropped so a reload does not
    // put it back.
    const params = new URLSearchParams(window.location.search);
    const question = params.get("q")?.trim();
    if (!question) return;
    setDraft(question.slice(0, 4000));
    params.delete("q");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, []);

  useEffect(() => {
    if (!searchModalOpen) return;
    // Typing waits a moment before searching, so each key is not a request.
    const timer = window.setTimeout(() => void loadChatSearchDetails(chatSearchQuery), chatSearchQuery.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [chatSearchQuery, loadChatSearchDetails, searchModalOpen]);

  useEffect(() => {
    if (!copiedMessageId) return;
    const timeoutId = window.setTimeout(() => setCopiedMessageId(null), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copiedMessageId]);

  useEffect(() => {
    if (!editingMessageId) return;
    window.requestAnimationFrame(() => {
      editComposerRef.current?.focus();
      const length = editingDraft.length;
      editComposerRef.current?.setSelectionRange(length, length);
    });
  }, [editingDraft.length, editingMessageId]);

  async function sendRequest(body: Record<string, unknown>) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = newChatRequestId();
    requestIdRef.current = requestId;

    setProgress(null);
    const response = await fetch(chatEndpoint(), {
      method: "POST",
      headers: {
        ...requestHeaders,
        Accept: "text/event-stream",
        "X-Chat-Request-Id": requestId,
      },
      body: JSON.stringify(normalizeChatRequestPayload(body)),
      signal: controller.signal,
    });
    try {
      return await readChatStream<ChatPayload>(response, (update) => {
        if (!controller.signal.aborted) setProgress(update);
      });
    } finally {
      setProgress(null);
    }
  }

  const waitForRepositoryJob = useCallback(async (jobId: string, threadId = activeThreadId) => {
    if (!threadId || repositoryJobPollsRef.current.has(jobId)) return;
    const controller = new AbortController();
    repositoryJobPollsRef.current.set(jobId, { controller, threadId });
    let transientFailures = 0;
    try {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const delayMs = Math.min(10_000, 2_000 + attempt * 250);
        await new Promise<void>((resolve) => {
          const timeoutId = window.setTimeout(resolve, delayMs);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timeoutId);
            resolve();
          }, { once: true });
        });
        if (controller.signal.aborted) return;
        try {
          const response = await fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`, {
            headers: requestHeaders,
            signal: controller.signal,
          });
          if (!response.ok) {
            if (response.status >= 500 && transientFailures < 5) {
              transientFailures += 1;
              continue;
            }
            throw new Error("Could not read repository report progress.");
          }
          transientFailures = 0;
          const payload = await response.json() as { job?: {
            status?: string; errorMessage?: string | null;
          } };
          const job = payload.job;
          if (job?.status === "succeeded") {
            await loadThreadDetail(threadId);
            await refreshThreads(threadId);
            return;
          }
          if (job?.status === "failed" || job?.status === "canceled") {
            await loadThreadDetail(threadId);
            if (job.status === "failed") {
              setError(job.errorMessage ?? "Repository report did not complete.");
            }
            return;
          }
        } catch (pollError) {
          if (controller.signal.aborted) return;
          if (transientFailures < 5) {
            transientFailures += 1;
            continue;
          }
          throw pollError;
        }
      }
      setError("Repository analysis is still running. It will remain attached to this conversation.");
    } catch (pollError) {
      if (!controller.signal.aborted) {
        setError(pollError instanceof Error ? pollError.message : "Could not read repository report progress.");
      }
    } finally {
      repositoryJobPollsRef.current.delete(jobId);
    }
  }, [activeThreadId, loadThreadDetail, refreshThreads, requestHeaders]);

  useEffect(() => {
    if (!canPersist || !activeThreadId) return;
    for (const message of messages) {
      const jobId = typeof message.metadata?.repositoryJobId === "string"
        ? message.metadata.repositoryJobId
        : null;
      const status = message.metadata?.repositoryJobStatus;
      if (jobId && (status === "queued" || status === "processing")) {
        void waitForRepositoryJob(jobId, activeThreadId);
      }
    }
  }, [activeThreadId, canPersist, messages, waitForRepositoryJob]);

  useEffect(() => {
    for (const [jobId, poll] of repositoryJobPollsRef.current) {
      if (!activeThreadId || poll.threadId !== activeThreadId) {
        poll.controller.abort();
        repositoryJobPollsRef.current.delete(jobId);
      }
    }
  }, [activeThreadId]);

  useEffect(() => () => {
    for (const poll of repositoryJobPollsRef.current.values()) poll.controller.abort();
    repositoryJobPollsRef.current.clear();
  }, []);

  function stopGenerating() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // Aborting the fetch only stops this browser reading. The server does not
    // learn that the reader left, so it is told explicitly or it runs every
    // remaining model call for an answer nobody will see.
    const requestId = requestIdRef.current;
    requestIdRef.current = null;
    if (requestId) {
      void fetch(chatEndpoint("/api/chat/cancel"), {
        method: "POST",
        headers: { ...requestHeaders },
        body: JSON.stringify({ requestId }),
        keepalive: true,
      }).catch(() => {
        // Stopping the screen already worked; a failed cancel only costs tokens.
      });
    }
    setProgress(null);
    setLoading(false);
  }

  function focusComposerWithDraft(nextDraft: string) {
    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      const length = nextDraft.length;
      composerRef.current?.setSelectionRange(length, length);
    });
  }

  function toggleLibraryRun(run: IngestionRunRow) {
    setSelectedLibraryRuns((current) => {
      const exists = current.some((item) => item.id === run.id);
      if (exists) {
        return current.filter((item) => item.id !== run.id);
      }
      return [...current, run];
    });
  }

  async function copyMessageContent(message: MessageView) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
    } catch {
      setError("Could not copy this message.");
    }
  }

  function startEditingUserMessage(message: MessageView) {
    if (activeThread?.mode === "deep_research") {
      setDeepResearchEnabled(true);
      focusComposerWithDraft(message.content);
      return;
    }
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  }

  function cancelEditingUserMessage() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  async function submitEditedUserMessage(message: MessageView) {
    const prompt = editingDraft.trim();
    if (!prompt) return;

    const editIndex = messages.findIndex((item) => item.id === message.id);
    if (editIndex < 0) {
      cancelEditingUserMessage();
      return;
    }

    const messageMetadata =
      message.metadata && typeof message.metadata === "object" ? message.metadata : {};
    const editedAttachments = attachmentsFromMetadata(messageMetadata);
    const editedRunIds = Array.isArray(messageMetadata.selectedRunIds)
      ? messageMetadata.selectedRunIds.map(String).filter(Boolean)
      : [];
    const nextMessages = messages.slice(0, editIndex + 1).map((item) =>
      item.id === message.id
        ? {
            ...item,
            content: prompt,
            metadata: {
              ...(item.metadata ?? {}),
              editedAt: new Date().toISOString(),
            },
          }
        : item
    );

    setLoading(true);
    setError(null);
    setMenuOpen(false);
    setParameterMenuOpen(false);
    setEditingMessageId(null);
    setEditingDraft("");
    setMessages(nextMessages);

    try {
      const payload = await sendRequest({
        message: prompt,
        model: selectedModel,
        generationParameters: {
          temperature: chatParameters.temperature,
          topP: chatParameters.topP,
          topK: chatParameters.topK,
          maxTokens: chatParameters.maxTokens,
          frequencyPenalty: chatParameters.frequencyPenalty,
          presencePenalty: chatParameters.presencePenalty,
        },
        attachments: editedAttachments,
        messages: nextMessages.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        selectedYears: effectiveSelectedYears,
        selectedTracks: effectiveSelectedTracks,
        searchQuery,
        folderId: activeKnowledgeScope.folderId,
        projectId: activeKnowledgeScope.projectId ?? undefined,
        knowledgeScope: activeKnowledgeScope,
        selectedRunIds: editedRunIds,
        toolMode: webSearchEnabled ? "web_search" : "auto",
        webSearchEnabled,
        threadId: activeThread?.mode === "normal" ? activeThread.id : undefined,
        editMessageId: message.id.startsWith("local-") ? undefined : message.id,
        chatMode: "normal",
        action: "message",
      });
      if (payload.thread && payload.messages) {
        applyPayload(payload);
      } else {
        setMessages([
          ...nextMessages,
          localMessage(
            "assistant",
            payload.answer ?? "No answer returned.",
            payload.citations ?? [],
            { mode: payload.mode ?? "fallback" }
          ),
        ]);
      }
      if (payload.jobId) {
        void waitForRepositoryJob(payload.jobId, payload.thread?.id ?? activeThreadId);
      }
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(
        nextError instanceof Error ? nextError.message : "Failed to edit message."
      );
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  async function handleNormalSend(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    if (!prompt) return;

    setLoading(true);
    setError(null);
    setMenuOpen(false);

    const nextMessages = [
      ...messages,
      localMessage("user", prompt, [], {
        attachments: selectedAttachments,
        selectedRunIds,
        knowledgeScope: activeKnowledgeScope,
        scopeSnapshot: activeScopeSnapshot,
      }),
    ];
    setMessages(nextMessages);
    setDraft("");

    try {
      const payload = await sendRequest({
        message: prompt,
        model: selectedModel,
        generationParameters: {
          temperature: chatParameters.temperature,
          topP: chatParameters.topP,
          topK: chatParameters.topK,
          maxTokens: chatParameters.maxTokens,
          frequencyPenalty: chatParameters.frequencyPenalty,
          presencePenalty: chatParameters.presencePenalty,
        },
        attachments: selectedAttachments,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        selectedYears: effectiveSelectedYears,
        selectedTracks: effectiveSelectedTracks,
        searchQuery,
        folderId: activeKnowledgeScope.folderId,
        projectId: activeKnowledgeScope.projectId ?? undefined,
        knowledgeScope: activeKnowledgeScope,
        selectedRunIds,
        toolMode: webSearchEnabled ? "web_search" : "auto",
        webSearchEnabled,
        threadId: activeThread?.mode === "normal" ? activeThread.id : undefined,
        chatMode: "normal",
        action: "message",
      });
      setSelectedLibraryRuns([]);
      if (payload.thread && payload.messages) {
        applyPayload(payload);
      } else {
        setMessages([
          ...nextMessages,
          localMessage(
            "assistant",
            payload.answer ?? "No answer returned.",
            payload.citations ?? [],
            { mode: payload.mode ?? "fallback" }
          ),
        ]);
      }
      if (payload.jobId) {
        void waitForRepositoryJob(payload.jobId, payload.thread?.id ?? activeThreadId);
      }
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(
        nextError instanceof Error ? nextError.message : "Chat request failed."
      );
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  async function handleChartModeSend() {
    const prompt =
      draft.trim() || "Create the most useful chart from my analyzed papers.";
    if (!canPersist) {
      setError("Sign in to build charts from repository data.");
      return;
    }

    setLoading(true);
    setError(null);
    setMenuOpen(false);
    setParameterMenuOpen(false);

    const nextMessages = [
      ...messages,
      localMessage("user", prompt, [], {
        toolMode: "chart",
        attachments: selectedAttachments,
        selectedRunIds,
        knowledgeScope: activeKnowledgeScope,
        scopeSnapshot: activeScopeSnapshot,
      }),
    ];
    setMessages(nextMessages);
    setDraft("");

    try {
      const payload = await sendRequest({
        message: prompt,
        model: selectedModel,
        attachments: selectedAttachments,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        selectedYears: effectiveSelectedYears,
        selectedTracks: effectiveSelectedTracks,
        searchQuery,
        folderId: activeKnowledgeScope.folderId,
        projectId: activeKnowledgeScope.projectId ?? undefined,
        knowledgeScope: activeKnowledgeScope,
        selectedRunIds,
        toolMode: "chart",
        threadId: activeThread?.mode === "normal" ? activeThread.id : undefined,
        chatMode: "normal",
        action: "message",
      });
      if (payload.thread && payload.messages) {
        applyPayload(payload);
      } else {
        setMessages([
          ...nextMessages,
          localMessage(
            "assistant",
            payload.answer ?? "No chart returned.",
            payload.citations ?? [],
            {
              mode: payload.mode ?? "fallback",
              toolResults: payload.toolResults ?? [],
              chart: payload.chart ?? null,
              charts: payload.charts ?? (payload.chart ? [payload.chart] : []),
            }
          ),
        ]);
      }
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(
        nextError instanceof Error ? nextError.message : "Chart request failed."
      );
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }


  async function handlePlanResearch() {
    const prompt = draft.trim();
    if (!prompt) return;
    if (!canPersist) {
      setError("Sign in to use deep research mode.");
      return;
    }

    setLoading(true);
    setError(null);
    setMenuOpen(false);
    const optimisticMessages = [
      ...messages,
      localMessage("user", prompt, [], {
        chatMode: "deep_research",
        attachments: selectedAttachments,
        selectedRunIds,
        knowledgeScope: activeKnowledgeScope,
        scopeSnapshot: activeScopeSnapshot,
        researchSourcePolicy: effectiveResearchSourcePolicy,
      }),
    ];
    setMessages(optimisticMessages);
    setDraft("");

    try {
      const payload = await sendRequest({
        message: prompt,
        attachments: selectedAttachments,
        folderId: activeKnowledgeScope.folderId,
        projectId: activeKnowledgeScope.projectId ?? undefined,
        knowledgeScope: activeKnowledgeScope,
        selectedRunIds,
        threadId: activeThread?.mode === "deep_research" ? activeThread.id : undefined,
        sessionId:
          activeThread?.mode === "deep_research" ? deepSession?.id : undefined,
        chatMode: "deep_research",
        action: "plan",
        researchSourcePolicy: effectiveResearchSourcePolicy,
      });
      applyPayload(payload);
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to plan deep research."
      );
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  async function handleContinueResearch() {
    if (!canPersist || !activeThread || !deepSession) return;
    setLoading(true);
    setResearchStarting(true);
    setError(null);
    try {
      const payload = await sendRequest({
        folderId: activeKnowledgeScope.folderId,
        projectId: activeKnowledgeScope.projectId ?? undefined,
        knowledgeScope: activeKnowledgeScope,
        selectedRunIds,
        threadId: activeThread.id,
        sessionId: deepSession.id,
        chatMode: "deep_research",
        action: "continue",
        researchSourcePolicy: effectiveResearchSourcePolicy,
      });
      applyPayload(payload);
      await refreshThreads(activeThread.id);
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to continue deep research."
      );
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setResearchStarting(false);
    }
  }

  function handleEditResearchPlan() {
    setDeepResearchEnabled(true);
    focusComposerWithDraft(deepSession?.prompt ?? "");
  }

  /** Stops a run (or drops a plan) on the server, not only on this page. */
  async function handleCancelResearch() {
    if (!canPersist || !activeThread || !deepSession) return;
    setError(null);
    try {
      const payload = await sendRequest({
        threadId: activeThread.id,
        sessionId: deepSession.id,
        chatMode: "deep_research",
        action: "cancel",
      });
      applyPayload(payload);
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(nextError instanceof Error ? nextError.message : "The research could not be canceled.");
    } finally {
      abortControllerRef.current = null;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) {
      stopGenerating();
      return;
    }
    forceScrollRef.current = true;
    if (deepResearchEnabled) {
      await handlePlanResearch();
      return;
    }
    if (chartModeEnabled) {
      await handleChartModeSend();
      return;
    }
    await handleNormalSend();
  }

  /** Sends a question the reader clicked rather than typed. */
  async function askQuestion(question: string) {
    if (loading) return;
    forceScrollRef.current = true;
    setDraft(question);
    await handleNormalSend(question);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function renameThread(thread: WorkspaceThreadSummary) {
    if (!canPersist || !session?.access_token) return;
    setRenameDraft(thread.title);
    setThreadDialog({ kind: "rename", thread });
  }

  function deleteThread(thread: WorkspaceThreadSummary) {
    if (!canPersist || !session?.access_token) return;
    setThreadDialog({ kind: "delete", thread });
  }

  async function confirmThreadDialog() {
    if (!threadDialog || threadDialogBusy) return;
    setThreadDialogBusy(true);
    try {
      if (threadDialog.kind === "rename") await saveThreadTitle(threadDialog.thread, renameDraft.trim());
      else await removeThread(threadDialog.thread);
    } finally {
      setThreadDialogBusy(false);
      setThreadDialog(null);
    }
  }

  async function saveThreadTitle(thread: WorkspaceThreadSummary, nextTitle: string) {
    if (!canPersist || !session?.access_token) return;
    if (!nextTitle || nextTitle === thread.title) return;

    try {
      const response = await fetch(`/api/chat/threads/${thread.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title: nextTitle,
          summary: thread.summary ?? null,
        }),
      });
      const payload = (await response.json()) as ChatThreadDetail & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to rename chat.");
      }
      setThreads((current) =>
        current.map((item) => (item.id === thread.id ? payload.thread : item))
      );
      if (activeThreadId === thread.id) {
        setActiveThread(payload.thread);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to rename chat."
      );
    }
  }

  async function removeThread(thread: WorkspaceThreadSummary) {
    if (!canPersist || !session?.access_token) return;

    try {
      const response = await fetch(`/api/chat/threads/${thread.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete chat.");
      }
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      setPinnedThreadIds((current) => current.filter((id) => id !== thread.id));
      if (activeThreadId === thread.id) {
        resetChat(deepResearchEnabled ? "deep_research" : "normal");
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to delete chat."
      );
    }
  }

  function togglePinnedThread(threadId: string) {
    setPinnedThreadIds((current) =>
      current.includes(threadId)
        ? current.filter((id) => id !== threadId)
        : [threadId, ...current]
    );
  }

  function handleCreatedRuns(
    runs: IngestionRunRow[],
    context: {
      folder: string;
      folderId?: string | null;
      sourceKind: string;
      folderJob?: { id: string; folder_id: string } | null;
    }
  ) {
    startAnalysisSession(runs, {
      sourceKind: context.sourceKind,
      folder: context.folder,
      folderId: context.folderId ?? null,
      folderJob: context.folderJob
        ? ({ id: context.folderJob.id } as FolderAnalysisJobRow)
        : null,
    });
    if (context.folderId) {
      setChatScopeFolderId(context.folderId);
    }
    setSelectedLibraryRuns(runs);
    void refreshFolders();
  }

  return (
    <>
      <div
        className={`flex min-h-0 w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-black dark:text-[#ececec] ${
          fullscreenEnabled
            ? "fixed inset-0 z-50 h-screen supports-[height:100dvh]:h-dvh"
            : "h-[calc(100vh-5rem)] supports-[height:100dvh]:h-[calc(100dvh-5rem)]"
        }`}
      >
        {chatListDrawer ? (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-black/40 motion-safe:animate-fade-in"
            onClick={() => setChatListOpen(false)}
          />
        ) : null}
        <aside
          ref={chatListRef}
          {...(chatListDrawer ? { role: "dialog", "aria-modal": true, "aria-label": "Your chats" } : {})}
          className={
            chatListDrawer
              ? "fixed inset-y-0 left-0 z-50 flex h-full w-[min(320px,86vw)] flex-col overscroll-contain border-r border-slate-200 bg-white p-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-overlay dark:border-[#1f1f1f] dark:bg-[#050505]"
              : `hidden h-full min-h-0 flex-none border-r border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505] lg:flex lg:flex-col ${
                  sidebarCompact ? "w-[60px] p-2" : "w-[288px] p-3"
                }`
          }
        >
          {sidebarCompact ? (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                aria-label="Open chat sidebar"
              >
                <SidebarIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => resetChat("normal")}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#ececec] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                aria-label="New chat"
              >
                <PencilSquareIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchModalOpen(true);
                  setChatSearchQuery("");
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#ececec] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                aria-label="Search chats"
              >
                <SearchIcon className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
              <button
                type="button"
                onClick={() => resetChat("normal")}
                className="inline-flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
              >
                <PencilSquareIcon className="h-5 w-5" />
                <span>New chat</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setChatListOpen(false);
                  setSearchModalOpen(true);
                  setChatSearchQuery("");
                }}
                className="inline-flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
              >
                <SearchIcon className="h-5 w-5" />
                <span>Search chats</span>
              </button>
              </div>
              <button
                type="button"
                onClick={() => (chatListDrawer ? setChatListOpen(false) : setSidebarCollapsed(true))}
                className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                aria-label={chatListDrawer ? "Close your chats" : "Close chat sidebar"}
              >
                <SidebarIcon className="h-5 w-5" />
              </button>
            </div>
          )}

          {!sidebarCompact ? (
          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="px-1">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-[#ececec]">
                Your chats
              </p>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {threadsLoading ? (
                <div className="rounded-xl px-3 py-3 text-sm text-slate-600 dark:text-[#8e8e8e]">
                  Loading...
                </div>
              ) : null}

              {!threadsLoading && sortedThreads.length === 0 ? (
                <div className="rounded-xl px-3 py-3 text-sm text-slate-600 dark:text-[#8e8e8e]">
                  {canPersist ? "No chats yet." : "Sign in to save chats."}
                </div>
              ) : null}

              {sortedThreads.map((thread) => {
                const active = thread.id === activeThreadId;
                const pinned = pinnedThreadIds.includes(thread.id);
                return (
                  <div
                    key={thread.id}
                    ref={threadMenuId === thread.id ? threadMenuRef : undefined}
                    className={`group relative rounded-xl px-2 ${
                      active
                        ? "bg-slate-200 dark:bg-[#050505]"
                        : "hover:bg-slate-100 dark:hover:bg-[#0a0a0a]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveThreadId(thread.id);
                        setThreadMenuId(null);
                        setChatListOpen(false);
                      }}
                      // The padding used to sit on the row wrapper, so the row
                      // looked 28px tall while only the 20px of text was
                      // clickable. Moving it onto the button makes the whole row
                      // the target it already appeared to be. On a touch screen
                      // the options button always shows, so the title stops
                      // short of it rather than running underneath.
                      className="block w-full min-w-0 py-1.5 text-left [@media(hover:none)]:pr-8"
                    >
                      <div className="flex items-center gap-2">
                        {pinned ? (
                          <PinIcon className="h-3.5 w-3.5 flex-none text-slate-600 dark:text-[#8e8e8e]" />
                        ) : null}
                        <span className="truncate text-[13px] font-medium text-slate-800 dark:text-[#ececec]">
                          {thread.title}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setThreadMenuId((current) =>
                          current === thread.id ? null : thread.id
                        )
                      }
                      aria-label={`Options for ${thread.title || "this chat"}`}
                      aria-haspopup="menu"
                      aria-expanded={threadMenuId === thread.id}
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-900 dark:text-[#8e8e8e] dark:hover:bg-[#0a0a0a] dark:hover:text-white group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </button>

                    {threadMenuId === thread.id ? (
                      <div className="absolute right-2 top-9 z-20 w-44 origin-top-right rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in">
                        <button
                          type="button"
                          onClick={() => {
                            togglePinnedThread(thread.id);
                            setThreadMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-body transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                        >
                          <PinIcon className="h-4 w-4" />
                          <span>{pinned ? "Unpin chat" : "Pin chat"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void renameThread(thread);
                            setThreadMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-body transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          <span>Rename</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteThread(thread);
                            setThreadMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-700 dark:text-red-300 dark:focus-visible:ring-red-300 dark:hover:bg-red-950/20 dark:focus-visible:bg-red-950/20"
                        >
                          <TrashIcon className="h-4 w-4" />
                          <span>Delete</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {threadsHasMore ? (
                <button
                  type="button"
                  onClick={() => void loadOlderThreads()}
                  disabled={olderThreadsLoading}
                  className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-mute transition-colors hover:bg-subtle hover:text-ink disabled:opacity-60"
                >
                  {olderThreadsLoading ? "Loading older chats\u2026" : "Show older chats"}
                </button>
              ) : null}
            </div>
          </div>
          ) : null}
        </aside>

        <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-slate-100 dark:bg-black">
          {/* Here, not in the transcript: positioned against this section, from
              inside the transcript it stood out below it, and on a phone the
              page scrolled its header away to follow it. */}
          <p className="sr-only" role="status" aria-live="polite">
            {answerAnnouncement}
          </p>
          <header className="flex h-14 flex-none items-center justify-between border-b border-hairline px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => resetChat("normal")}
                aria-label="Start a new chat"
                title="New chat"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 dark:border-[#1f1f1f] dark:text-[#ececec] lg:hidden"
              >
                <PencilSquareIcon className="h-4 w-4" />
              </button>
              {/* Below the large breakpoint the conversation list opens as a
                  drawer, with the sidebar's actions (CHAT-8). */}
              <button
                type="button"
                onClick={() => setChatListOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={chatListDrawer}
                aria-label="Open your chats"
                title="Your chats"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 dark:border-[#1f1f1f] dark:text-[#ececec] lg:hidden"
              >
                <ListViewIcon className="h-4 w-4" />
              </button>
              <p className="truncate text-lg font-semibold text-slate-900 dark:text-[#ececec]">
                {pageTitle}
              </p>
            </div>

            <div className="relative flex items-center gap-2" ref={conversationMenuRef}>
              {deepSession ? (
                <span className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]">
                  {sessionLabel(deepSession) ?? "Saved"}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setFullscreenEnabled((current) => !current)}
                title={fullscreenEnabled ? "Exit fullscreen" : "Fullscreen"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                aria-label={fullscreenEnabled ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {fullscreenEnabled ? (
                  <ExitFullscreenIcon className="h-4 w-4" />
                ) : (
                  <FullscreenIcon className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setConversationMenuOpen((current) => !current)}
                title="Conversation menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                aria-label="Open conversation menu"
                aria-expanded={conversationMenuOpen}
              >
                <MoreHorizontalIcon className="h-4 w-4" />
              </button>
              {conversationMenuOpen ? (
                <div className="absolute right-0 top-11 z-30 w-60 origin-top-right rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in">
                  <button
                    type="button"
                    onClick={() => {
                      setSourcesPanelOpen(true);
                      setConversationMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-body transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                  >
                    <PaperIcon className="h-4 w-4" />
                    <span className="min-w-0 flex-1">Sources</span>
                    <span className="text-xs text-slate-600 dark:text-[#8e8e8e]">{conversationSources.length}</span>
                  </button>
                  <button
                    type="button"
                    disabled={exportingConversation || visibleMessages.length === 0}
                    onClick={() => {
                      setConversationMenuOpen(false);
                      void exportConversation();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-body transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    <span className="min-w-0 flex-1">{exportingConversation ? "Exporting\u2026" : "Export conversation (.md)"}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          <div
            ref={scrollContainerRef}
            onScroll={handleTranscriptScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-8 sm:px-6 xl:px-8"
          >

            {!hasContent && !loading && !detailLoading ? (
              <ChatIntro
                scopeLabel={scopeSummary?.scopeLabel || activeScopeSnapshot.label}
                eligiblePaperCount={scopeSummary?.eligiblePaperCount ?? null}
                examples={
                  scopeSummary?.examples?.length
                    ? scopeSummary.examples
                    : exampleQuestions([], activeScopeSnapshot.label)
                }
                onAsk={(question) => void askQuestion(question)}
              />
            ) : (
              <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-7">
                {hasEarlierMessages ? (
                  <button
                    type="button"
                    onClick={() => void loadEarlierMessages()}
                    disabled={earlierLoading}
                    className="mx-auto rounded-full border border-hairline bg-surface px-4 py-1.5 text-xs font-medium text-body transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-60"
                  >
                    {earlierLoading ? "Loading earlier messages\u2026" : "Load earlier messages"}
                  </button>
                ) : null}
                {visibleMessages.map((message, messageIndex) => {
                  const isUser = message.role === "user";
                  const charts = chartsFromMetadata(message.metadata);
                  const attachments = attachmentsFromMetadata(message.metadata);
                  const scopeSnapshot = scopeSnapshotFromMetadata(message.metadata);
                  const groundingMode = groundingModeFromMetadata(message.metadata);
                  const citationPreview = previewConversationSources(numberAnswerSources(message.content, message.citations), 5);
                  return (
                    <section key={message.id}>
                      {isUser ? (
                        <div className="flex justify-end">
                          <div className="group/message relative max-w-[78%] space-y-2">
                            {editingMessageId === message.id ? (
                              <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
                                <MessageAttachmentList attachments={attachments} />
                                <textarea
                                  ref={editComposerRef}
                                  value={editingDraft}
                                  onChange={(event) => setEditingDraft(event.target.value)}
                                  aria-label="Edit message"
                                  rows={Math.min(8, Math.max(3, editingDraft.split("\n").length))}
                                  className="mt-3 max-h-[260px] min-h-[96px] w-full resize-none bg-transparent text-base leading-8 sm:text-[15px] text-slate-900 outline-none placeholder:text-slate-600 dark:text-white dark:placeholder:text-[#8e8e8e]"
                                />
                                <div className="mt-4 flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={cancelEditingUserMessage}
                                    className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:hover:bg-[#0a0a0a]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void submitEditedUserMessage(message)}
                                    disabled={!editingDraft.trim() || loading}
                                    className="inline-flex h-10 items-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-[#171717] dark:hover:bg-[#f1f1f1]"
                                  >
                                    Send
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="absolute -top-8 right-1 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => void copyMessageContent(message)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:bg-[#030303] dark:text-[#ececec] dark:ring-[#242424] dark:hover:bg-[#0a0a0a]"
                                    aria-label="Copy message"
                                    title="Copy"
                                  >
                                    {copiedMessageId === message.id ? (
                                      <CheckIcon key="copied" className="h-4 w-4 animate-scale-in" />
                                    ) : (
                                      <CopyIcon key="copy" className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditingUserMessage(message)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:bg-[#030303] dark:text-[#ececec] dark:ring-[#242424] dark:hover:bg-[#0a0a0a]"
                                    aria-label="Edit message"
                                    title="Edit"
                                  >
                                    <PencilSquareIcon className="h-4 w-4" />
                                  </button>
                                </div>
                                <div className="rounded-[18px] border border-slate-200 bg-white px-5 py-3 text-[15px] leading-8 text-slate-900 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#f3f3f3]">
                                  {renderRichMessage(message.content, message.id, "user")}
                                </div>
                                <MessageAttachmentList attachments={attachments} />
                                {scopeSnapshot ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuView("scope");
                                      setMenuOpen(true);
                                    }}
                                    title={scopeSnapshot.eligiblePaperCount > 0
                                      ? `${scopeSnapshot.eligiblePaperCount} analyzed paper${scopeSnapshot.eligiblePaperCount === 1 ? "" : "s"} in this message scope`
                                      : "Knowledge scope used for this message"}
                                    className="ml-auto inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                                  >
                                    <FolderIcon className="h-3.5 w-3.5 flex-none" />
                                    <span className="truncate">{scopeSnapshot.label}</span>
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* A stable hook for the layout-shift measurement, which has to
                              tell an answer arriving from the intro disappearing. */}
                          {message.kind === "deep_research_report" ? (
                            <p className="text-xs font-semibold text-slate-600 dark:text-[#a3a3a3]">Deep research report</p>
                          ) : null}
                          <div data-testid="assistant-message">
                            <AssistantAnswer
                              content={message.content}
                              messageId={message.id}
                              citations={message.citations}
                              unfolded={message.kind === "deep_research_report"}
                            />
                          </div>
                          {message.kind === "deep_research_report" ? (
                            <ReportActions
                              content={message.content}
                              citations={message.citations.map((citation) => ({ ...citation, paperId: String(citation.paperId) }))}
                              title={researchTitle}
                            />
                          ) : null}
                          {groundingMode === "general" ? (
                            <div className="text-xs text-slate-600 dark:text-[#8e8e8e]">
                              Repository context not used
                            </div>
                          ) : null}
                          {charts.map((chart, chartIndex) =>
                            chart.chartType === "insight" && chart.insight ? (
                              <ChatInsightCard
                                key={`${message.id}-chart-${chartIndex}-${chart.title}`}
                                chart={{ title: chart.title, scopeLabel: chart.scopeLabel, insight: chart.insight, papers: chart.papers }}
                              />
                            ) : (
                              <ChatChartCard
                                key={`${message.id}-chart-${chartIndex}-${chart.title}`}
                                chart={chart}
                              />
                            )
                          )}
                          <AnswerCaveats metadata={message.metadata} />
                          {message.kind !== "deep_research_report" && isFinishedAnswer(message) ? (
                            <MarkdownActions
                              markdown={() => answerMarkdown(message.content, message.citations, message.metadata)}
                              fileName={markdownFileName(questionBefore(visibleMessages, messageIndex) || pageTitle, "papertrend-answer")}
                              copyLabel="Copy"
                              label="Answer actions"
                              compact
                            />
                          ) : null}
                          {message.role === "assistant" && message === visibleMessages[visibleMessages.length - 1] && !loading && isFinishedAnswer(message) ? (
                            <FollowUpSuggestions
                              suggestions={followUpSuggestions({
                                limitations: limitationsFromMetadata(message.metadata),
                                missingEvidenceNeeds: missingEvidenceNeedsFromMetadata(message.metadata),
                                citedPaperCount: message.citations.length,
                                scopedPaperCount: coveredPaperCount(message.metadata),
                              })}
                              onAsk={(question) => void askQuestion(question)}
                            />
                          ) : null}
                          {message.citations.length > 0 ? (
                            <div className="max-w-[720px] space-y-1.5">
                              {citationPreview.visible.map((citation) => (
                                <CitationLink
                                  key={`${message.id}-${citation.sourceType ?? "paper"}-${citation.paperId}`}
                                  citation={citation}
                                  number={citation.number}
                                  compact
                                />
                              ))}
                              {citationPreview.remaining > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setSourcesPanelOpen(true)}
                                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d4d4d4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                                >
                                  <PaperIcon className="h-3.5 w-3.5" />
                                  {citationPreview.remaining} more
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </section>
                  );
                })}

                {loading ? (
                  <div className="flex items-start gap-3">
                    <ThinkingOrb
                      size={32}
                      className="mt-0.5"
                      state={
                        chartModeEnabled
                          ? "shaping"
                          : deepResearchEnabled
                            ? deepSession?.status === "planned"
                              ? "breathing"
                              : "working"
                            : orbStateForStage(progress?.stage)
                      }
                    />
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span aria-live="polite">
                          {/* Keyed on the words, so each new step slides in
                              rather than replacing the last one in place. */}
                          <span key={progress?.label ?? "pending"} className="status-swap inline-block">
                            {progress?.label ??
                              renderLoadingLabel(
                                deepResearchEnabled,
                                chartModeEnabled,
                                deepSession,
                                researchStarting
                              )}
                          </span>
                        </span>
                        {progress?.detail ? (
                          <span className="text-xs text-slate-600 dark:text-[#8e8e8e]">
                            {progress.detail}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Research progress and the report sit after the conversation (docs/32, 2.7):
                above it, the card grew out of sight of a reader at the bottom. */}
            {deepSession ? (
              <section className="mx-auto mt-6 w-full max-w-[1040px]">
                {deepSession.status === "completed" && researchReport ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-[#b4b4b4]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Research completed</span>
                        <span className="text-slate-600 dark:text-[#8e8e8e]">·</span>
                        <span>
                          {researchProgress.completedSteps}/{Math.max(
                            researchProgress.totalSteps,
                            researchProgress.completedSteps
                          )}{" "}
                          steps
                        </span>
                        {deepSession.folder_id ? (
                          <>
                            <span className="text-slate-600 dark:text-[#8e8e8e]">·</span>
                            <span>{buildFolderLabel(deepSession.folder_id, folders)}</span>
                          </>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ReportActions content={researchReport} citations={researchReportCitations} title={researchTitle} />
                        <button
                          type="button"
                          onClick={() => setReportFullViewOpen(true)}
                          className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                        >
                          Full view
                        </button>
                      </div>
                    </div>

                    <ResearchEvidenceSummary summary={researchEvidenceSummary} />

                    <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.12)] dark:border-[#1f1f1f] dark:bg-[#030303] dark:shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
                      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#1f1f1f]">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#1d4ed8] text-white">
                            <SparkIcon className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-[#ececec]">
                              {researchTitle}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-[#8e8e8e]">
                              Deep research report
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReportFullViewOpen(true)}
                          className="inline-flex h-9 items-center rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                        >
                          Expand
                        </button>
                      </div>

                      <article className="space-y-5 px-6 py-7 sm:px-10 sm:py-10">
                        <h2 className="text-[2rem] font-semibold tracking-normal text-slate-900 dark:text-[#ececec] sm:text-[2.6rem]">
                          {researchTitle}
                        </h2>
                        {renderRichMessage(
                          researchBlocks.slice(0, 6).join(REPORT_BLOCK_SEPARATOR),
                          `${deepSession.id}-report`,
                          "assistant",
                          researchMarked.sources
                        )}
                        {researchBlocks.length > 6 ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]">
                            Continue in full view to read the rest of the report.
                          </div>
                        ) : null}
                      </article>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#1d4ed8] text-white">
                            <SparkIcon className="h-4 w-4" />
                          </span>
                          <p className="text-[1.35rem] font-semibold tracking-normal text-slate-900 dark:text-[#ececec]">
                            {researchTitle}
                          </p>
                          {deepSession.folder_id ? (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]">
                              {buildFolderLabel(deepSession.folder_id, folders)}
                            </span>
                          ) : null}
                        </div>
                        {researchV2 ? (
                          <ResearchV2Summary session={deepSession} scopeLabel={researchScopeLabel} />
                        ) : (
                          <>
                            {deepSession.plan_summary ? (
                              <p className={`mt-3 max-w-3xl ${ANSWER_META_SM_CLASS} text-slate-600 dark:text-[#b4b4b4]`}>
                                {deepSession.plan_summary}
                              </p>
                            ) : null}
                            <ResearchChoices session={deepSession} />
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {deepSession.status === "planned" && !researchV2 ? (
                          // Planned before deep research v2: it ran on a worker that is gone
                          // (docs/32, long-term health), so it is planned again instead.
                          <>
                            <p className={`max-w-xs ${ANSWER_META_SM_CLASS} text-slate-600 dark:text-[#b4b4b4]`}>
                              Planned by an earlier version of Papertrend, so it can no longer be run.
                            </p>
                            <button
                              type="button"
                              onClick={handleEditResearchPlan}
                              className="inline-flex h-11 flex-none items-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-[#111111] dark:hover:bg-[#f1f1f1]"
                            >
                              Plan again
                            </button>
                          </>
                        ) : deepSession.status === "planned" ? (
                          <>
                            <button
                              type="button"
                              onClick={handleEditResearchPlan}
                              className="inline-flex h-11 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => (researchV2 ? void handleCancelResearch() : resetChat("deep_research"))}
                              className="inline-flex h-11 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleContinueResearch()}
                              disabled={loading}
                              className="inline-flex h-11 items-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-[#111111] dark:hover:bg-[#f1f1f1]"
                            >
                              Start
                            </button>
                          </>
                        ) : researchV2 && deepSession.status === "processing" ? (
                          <button
                            type="button"
                            onClick={() => void handleCancelResearch()}
                            className="inline-flex h-11 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                          >
                            Stop research
                          </button>
                        ) : researchV2 && (deepSession.status === "failed" || deepSession.status === "canceled") ? (
                          <>
                            <button
                              type="button"
                              onClick={handleEditResearchPlan}
                              className="inline-flex h-11 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleContinueResearch()}
                              disabled={loading}
                              className="inline-flex h-11 items-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-[#111111] dark:hover:bg-[#f1f1f1]"
                            >
                              {deepSession.status === "failed" ? "Retry" : "Resume"}
                            </button>
                          </>
                        ) : researchV2 && deepSession.status === "completed" ? null : (
                          <button
                            type="button"
                            onClick={handleEditResearchPlan}
                            className="inline-flex h-11 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                          >
                            Update
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
                      {researchV2 ? null : <ResearchEvidenceSummary summary={researchEvidenceSummary} />}

                      {researchProgress.steps.map((step) => {
                        const isObsolete = step.output_payload?.result_kind === "obsolete";
                        const isBlocked =
                          step.status === "waiting" ||
                          step.output_payload?.result_kind === "blocked";
                        const isComplete =
                          step.status === "completed" && !isObsolete && !isBlocked;
                        const isProcessing =
                          step.status === "processing" ||
                          (deepSession.status === "waiting_on_analysis" &&
                            step.status === "waiting");
                        const isPending = step.status === "planned";
                        const isFailed = step.status === "failed";
                        const isAppended = step.input_payload?.origin && step.input_payload.origin !== "initial";
                        const statusReason =
                          step.output_payload?.status_reason?.trim() ||
                          step.input_payload?.statusReason?.trim() ||
                          "";
                        const stepBody =
                          step.output_payload?.summary?.trim() ||
                          step.description?.trim() ||
                          "";
                        const stepWarnings = extractStepWarnings(step);
                        const unresolvedSections = extractStepUnresolvedSections(step);
                        const stepEvidenceItems = extractStepEvidenceItems(step).slice(0, 2);
                        const citationCount = extractStepCitations(step).length;
                        const completionKind = step.output_payload?.completion_kind;
                        const phaseLabel = formatResearchPhase(step.input_payload?.phaseClass);
                        const sourceCounts =
                          step.output_payload?.diagnostics &&
                          typeof step.output_payload.diagnostics === "object" &&
                          "source_counts" in step.output_payload.diagnostics
                            ? (step.output_payload.diagnostics.source_counts as {
                                paper?: number;
                                web?: number;
                                total?: number;
                              })
                            : null;
                        return (
                          <div
                            key={step.id}
                            className="flex items-start gap-4 text-left"
                          >
                            <span
                              className={`mt-1 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full ${
                                isComplete
                                  ? "bg-slate-900 text-white dark:bg-white dark:text-[#111111]"
                                  : isProcessing
                                    ? "border border-slate-400 bg-transparent text-slate-700 dark:border-white dark:text-white"
                                  : isBlocked
                                      ? "border border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-200"
                                    : isPending
                                      ? "border border-slate-300 bg-transparent text-transparent dark:border-[#1f1f1f]"
                                      : "border border-red-400/50 bg-red-500/10 text-red-700 dark:text-red-300"
                              }`}
                            >
                              {isComplete ? (
                                <CheckCircleIcon className="h-4 w-4" />
                              ) : isBlocked ? (
                                <CircleIcon className="h-4 w-4 opacity-90" />
                              ) : isFailed ? (
                                <CloseIcon className="h-3.5 w-3.5" />
                              ) : (
                                <CircleIcon
                                  className={`h-4 w-4 ${isProcessing ? "animate-pulse" : "opacity-60"}`}
                                />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[15px] leading-8 text-slate-900 dark:text-[#ececec]">
                                  {step.title}
                                </p>
                                {isAppended ? (
                                  <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal text-blue-700 dark:text-blue-200">
                                    Added
                                  </span>
                                ) : null}
                                {phaseLabel ? (
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-[#1f1f1f] dark:bg-white/5 dark:text-[#8e8e8e]">
                                    {phaseLabel}
                                  </span>
                                ) : null}
                                {completionKind === "partial" ? (
                                  <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal text-amber-700 dark:text-amber-200">
                                    Partial
                                  </span>
                                ) : null}
                                {isObsolete ? (
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal text-slate-600 dark:border-[#1f1f1f] dark:bg-white/5 dark:text-[#b4b4b4]">
                                    Obsolete
                                  </span>
                                ) : null}
                                {isBlocked ? (
                                  <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal text-amber-700 dark:text-amber-200">
                                    Waiting on recovery
                                  </span>
                                ) : null}
                                {isFailed ? (
                                  <span className="rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal text-red-700 dark:text-red-200">
                                    Failed
                                  </span>
                                ) : null}
                              </div>
                              {stepBody ? (
                                <p className={`${ANSWER_META_SM_CLASS} text-slate-600 dark:text-[#b4b4b4]`}>
                                  {stepBody}
                                </p>
                              ) : null}
                              {statusReason ? (
                                <p className="text-xs leading-5 text-slate-600 dark:text-[#8e8e8e]">
                                  {statusReason}
                                </p>
                              ) : null}
                              {sourceCounts ? (
                                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-[#8e8e8e]">
                                  Sources: {sourceCounts.total ?? 0} total,{" "}
                                  {sourceCounts.paper ?? 0} library,{" "}
                                  {sourceCounts.web ?? 0} web
                                </p>
                              ) : null}
                              {citationCount > 0 ? (
                                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-[#8e8e8e]">
                                  Evidence ledger: {citationCount} citation
                                  {citationCount === 1 ? "" : "s"}
                                </p>
                              ) : null}
                              {stepWarnings.length > 0 ||
                              unresolvedSections.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {stepWarnings.slice(0, 2).map((warning) => (
                                    <span
                                      key={`${step.id}-warning-${warning}`}
                                      className="rounded-full border border-amber-300/50 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
                                    >
                                      {warning}
                                    </span>
                                  ))}
                                  {unresolvedSections.slice(0, 3).map((section) => (
                                    <span
                                      key={`${step.id}-missing-${section}`}
                                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-[#1f1f1f] dark:bg-white/5 dark:text-[#b4b4b4]"
                                    >
                                      Missing: {section}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              {stepEvidenceItems.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                  {stepEvidenceItems.map((item, evidenceIndex) => (
                                    <div
                                      key={`${step.id}-evidence-${item.paperId}-${evidenceIndex}`}
                                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-[#1f1f1f] dark:bg-[#030303]"
                                    >
                                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-normal text-slate-600 dark:text-[#8e8e8e]">
                                        <span>{item.section || item.requested_section}</span>
                                        <span className="text-slate-600 dark:text-[#8e8e8e]">
                                          |
                                        </span>
                                        <span>
                                          Relevance{" "}
                                          {Number.isFinite(item.relevance_score)
                                            ? item.relevance_score.toFixed(2)
                                            : "n/a"}
                                        </span>
                                      </div>
                                      <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-700 dark:text-[#d4d4d4]">
                                        {item.title}
                                      </p>
                                      <p className={`mt-1 line-clamp-2 ${ANSWER_META_CLASS} text-slate-600 dark:text-[#a3a3a3]`}>
                                        {item.snippet}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {deepSession.status !== "planned" ? (
                      <div className="mt-6">
                        <div className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-[#b4b4b4]">
                          <span>{researchProgress.detail}</span>
                          <span>
                            {researchProgress.completedSteps}/{Math.max(
                              researchProgress.totalSteps,
                              researchProgress.completedSteps
                            )}{" "}
                            steps
                          </span>
                        </div>
                        <div className="mt-3 h-2.5 rounded-full bg-slate-200 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-slate-900 transition-[width] duration-500 dark:bg-white"
                            style={{
                              width: `${Math.max(
                                6,
                                Math.min(100, researchProgress.ratio * 100)
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {deepSession.status === "failed" && deepSession.last_error ? (
                      <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
                        {deepSession.last_error}
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}

            {detailLoading ? (
              <div className="mx-auto mt-4 flex w-full max-w-[1040px] items-center gap-3 text-sm text-slate-600 dark:text-[#8e8e8e]">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-[#1f1f1f] dark:border-t-white" />
                <span>Loading chat…</span>
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>

          <div ref={composerAreaRef} className="flex-none bg-slate-100 px-4 pb-6 pt-3 dark:bg-black sm:px-6 xl:px-8">
            <form onSubmit={handleSubmit} className="mx-auto w-full max-w-[1040px]">
              {/* The composer shows keyboard focus on its own border, rather
                  than an outline drawn inside it around the text box. */}
              <div className="rounded-xl border border-slate-200 bg-white px-4 pb-3 pt-3 shadow-[0_10px_34px_rgba(15,23,42,0.12)] transition-colors duration-150 has-[textarea:focus-visible]:border-[rgb(var(--focus))] dark:border-[#1f1f1f] dark:bg-[#050505] dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)] dark:has-[textarea:focus-visible]:border-[rgb(var(--focus))]">
                {error ? (
                  <div role="alert" className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
                    {error}
                  </div>
                ) : null}

                {selectedLibraryRuns.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {selectedLibraryRuns.map((run) => {
                      const Glyph = runGlyph(run);
                      return (
                        <span
                          key={run.id}
                          className="group inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d4d4d4]"
                        >
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${runGlyphTone(run)}`}
                          >
                            <Glyph className="h-3.5 w-3.5" />
                          </span>
                          <span className="max-w-[180px] truncate">
                            {runTitleOf(run)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedLibraryRuns((current) =>
                                current.filter((item) => item.id !== run.id)
                              )
                            }
                            className="-my-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-600 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-900 dark:text-[#8e8e8e] dark:hover:bg-[#0a0a0a] dark:hover:text-white group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                            aria-label={`Remove ${runTitleOf(run)}`}
                          >
                            <CloseIcon className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {chartSuggestionVisible ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-100">
                    <span className="inline-flex items-center gap-2">
                      <ChartIcon className="h-4 w-4" />
                      Use Chart mode for this request.
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setChartModeEnabled(true);
                          setDeepResearchEnabled(false);
                        }}
                        className="rounded-full bg-sky-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-800 dark:bg-sky-200 dark:text-sky-950 dark:hover:bg-white"
                      >
                        Use Chart mode
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartSuggestionDismissedFor(trimmedDraft)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-sky-800 hover:bg-sky-100 dark:text-sky-100 dark:hover:bg-[#0a0a0a]"
                        aria-label="Dismiss chart mode suggestion"
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                ) : null}

                {deepResearchEnabled ? (
                  <p className="mb-2 flex items-start gap-2 text-xs leading-5 text-mute">
                    <SparkIcon className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>
                      Deep research breaks your question into up to 5 parts, reads the full text of every paper in scope,
                      searches the web only where the papers cannot answer, and checks every claim against its source.
                      You see the plan before it starts.
                    </span>
                  </p>
                ) : null}

                {/* What this question will search, before it is sent. The
                    count comes from the same scope loader the answer uses, so
                    the number here and the number the answer reports cannot
                    disagree. */}
                <p
                  data-testid="composer-scope"
                  className={`px-1 pb-1 ${ANSWER_META_CLASS} text-slate-600 dark:text-[#8e8e8e]`}
                >
                  {/* Chosen papers are counted here, not by the summary: it is asked
                      by repository and folder, so with papers chosen it described
                      the whole account ("52 analysed papers in All projects")
                      while the question searched only the chosen ones. */}
                  {activeKnowledgeScope.kind === "selected_papers"
                    ? scopeDescription(activeScopeSnapshot.label, null)
                    : scopeDescription(
                        scopeSummary?.scopeLabel || activeScopeSnapshot.label,
                        scopeSummary?.eligiblePaperCount ?? null
                      )}
                </p>

                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  aria-label="Message"
                  placeholder={
                    chartModeEnabled
                      ? "Ask for a repository chart, or leave blank for the best chart"
                      : "Ask the repository…"
                  }
                  rows={1}
                  className="max-h-[220px] min-h-[28px] w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-[16px] leading-8 text-slate-900 outline-none focus-visible:outline-none placeholder:text-slate-600 dark:text-[#ececec] dark:placeholder:text-[#8e8e8e]"
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="relative" ref={toolMenuRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuView("root");
                          setMenuOpen((current) => !current);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                        aria-label="Open attachment and tool menu"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <PlusIcon className="h-5 w-5" />
                      </button>

                      {menuOpen ? (
                        <div className="absolute bottom-12 left-0 z-30 w-[min(21rem,calc(100vw-2rem))] origin-bottom-left overflow-hidden rounded-xl border border-hairline bg-surface shadow-overlay motion-safe:animate-scale-in">
                          {menuView === "scope" ? (
                            <>
                              <div className="flex h-12 items-center gap-2 border-b border-slate-200 px-2 dark:border-[#1f1f1f]">
                                <button
                                  type="button"
                                  onClick={() => setMenuView("root")}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#b4b4b4] dark:hover:bg-[#0f0f0f] dark:hover:text-white"
                                  aria-label="Back to chat tools"
                                >
                                  <ChevronDownIcon className="h-4 w-4 rotate-90" />
                                </button>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">Repository scope</p>
                                  <p className="truncate text-[11px] text-slate-600 dark:text-[#8e8e8e]">Choose what this message can use</p>
                                </div>
                              </div>
                              <div className="max-h-80 overflow-y-auto p-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    scopeChosenRef.current = true;
                                    setChatScopeProjectId("all");
                                    setChatScopeFolderId("all");
                                    setSelectedLibraryRuns([]);
                                    setMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${chatScopeProjectId === "all" && chatScopeFolderId === "all" ? "bg-slate-100 dark:bg-[#111111]" : "hover:bg-slate-50 dark:hover:bg-[#0a0a0a]"}`}
                                >
                                  <BooksIcon className="h-4 w-4 flex-none text-slate-600 dark:text-[#b4b4b4]" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-[#ececec]">All repositories</span>
                                    <span className="block truncate text-[11px] text-slate-600 dark:text-[#8e8e8e]">Every analyzed paper in this account</span>
                                  </span>
                                  {chatScopeProjectId === "all" && chatScopeFolderId === "all" ? <CheckIcon className="h-4 w-4 flex-none" /> : null}
                                </button>
                                {allProjects.length > 0 ? (
                                  <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-slate-600 dark:text-[#8e8e8e]">Repositories</p>
                                ) : null}
                                {allProjects.map((project) => {
                                  const projectActive = chatScopeProjectId === project.id && chatScopeFolderId === "all";
                                  return (
                                    <button
                                      key={project.id}
                                      type="button"
                                      onClick={() => {
                                        scopeChosenRef.current = true;
                                        setChatScopeProjectId(project.id);
                                        setChatScopeFolderId("all");
                                        setSelectedLibraryRuns([]);
                                        setMenuOpen(false);
                                      }}
                                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${projectActive ? "bg-slate-100 dark:bg-[#111111]" : "hover:bg-slate-50 dark:hover:bg-[#0a0a0a]"}`}
                                    >
                                      <BooksIcon className="h-4 w-4 flex-none text-slate-600 dark:text-[#b4b4b4]" />
                                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-[#ececec]">{project.name}</span>
                                      {projectActive ? <CheckIcon className="h-4 w-4 flex-none" /> : null}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <div className="p-2">
                              <p className="px-3 pb-1 pt-1 text-[11px] font-medium text-slate-600 dark:text-[#8e8e8e]">Context</p>
                              <button
                                type="button"
                                onClick={() => setMenuView("scope")}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                              >
                                <FolderIcon className="h-4 w-4 flex-none text-slate-600 dark:text-[#b4b4b4]" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium text-slate-900 dark:text-[#ececec]">Repository scope</span>
                                  <span className="block truncate text-[11px] text-slate-600 dark:text-[#8e8e8e]">{activeFolderLabel}</span>
                                </span>
                                <ChevronDownIcon className="h-4 w-4 flex-none -rotate-90 text-slate-600" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowLibraryPicker(true);
                                  setMenuOpen(false);
                                }}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                              >
                                <FileIcon className="h-4 w-4 flex-none text-slate-600 dark:text-[#b4b4b4]" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium text-slate-900 dark:text-[#ececec]">Attach papers</span>
                                  <span className="block text-[11px] text-slate-600 dark:text-[#8e8e8e]">Choose specific papers from any repository</span>
                                </span>
                                {selectedLibraryRuns.length > 0 ? <span className="text-xs font-medium">{selectedLibraryRuns.length}</span> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAnalyzeModal(true);
                                  setMenuOpen(false);
                                }}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                              >
                                <PaperIcon className="h-4 w-4 flex-none text-slate-600 dark:text-[#b4b4b4]" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium text-slate-900 dark:text-[#ececec]">Upload a paper</span>
                                  <span className="block text-[11px] text-slate-600 dark:text-[#8e8e8e]">Analyze and add it to this repository</span>
                                </span>
                              </button>

                              <div className="my-2 border-t border-slate-200 dark:border-[#1f1f1f]" />
                              <p className="px-3 pb-1 text-[11px] font-medium text-slate-600 dark:text-[#8e8e8e]">Tools</p>
                              {[
                                { key: "chart", label: "Chart mode", description: "Build a chart from repository data", icon: ChartIcon, active: chartModeEnabled },
                                { key: "web", label: "Web search", description: "Add current external sources", icon: SearchIcon, active: webSearchEnabled },
                                { key: "research", label: "Deep research", description: "Run a longer evidence workflow", icon: SparkIcon, active: deepResearchEnabled },
                              ].map((item) => {
                                const Icon = item.icon;
                                return (
                                  <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => {
                                      if (item.key === "chart") {
                                        setChartModeEnabled(!chartModeEnabled);
                                        setDeepResearchEnabled(false);
                                      } else if (item.key === "web") {
                                        setWebSearchEnabled(!webSearchEnabled);
                                      } else {
                                        const nextEnabled = !deepResearchEnabled;
                                        setDeepResearchEnabled(nextEnabled);
                                        setChartModeEnabled(false);
                                      }
                                      setMenuOpen(false);
                                    }}
                                    // A tool says whether it is on, not only with a tick (docs/32, 3.4; audit CHAT-10, A11Y-7).
                                    aria-pressed={item.active}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70 ${item.active ? "bg-subtle shadow-[inset_3px_0_0_rgb(var(--ink))]" : "hover:bg-subtle"}`}
                                  >
                                    <Icon className="h-4 w-4 flex-none text-slate-600 dark:text-[#b4b4b4]" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-sm font-medium text-slate-900 dark:text-[#ececec]">{item.label}</span>
                                      <span className="block text-[11px] text-slate-600 dark:text-[#8e8e8e]">{item.description}</span>
                                    </span>
                                    {item.active ? <CheckIcon className="h-4 w-4 flex-none" /> : null}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}

                    </div>

                    {!deepResearchEnabled && !chartModeEnabled && MODEL_OPTIONS.length === 1 ? (
                      // One model: named, not offered as a choice.
                      <span className="inline-flex h-9 items-center gap-1.5 px-2 text-xs font-medium text-slate-600 dark:text-[#b4b4b4]">
                        {(() => {
                          const only = MODEL_OPTIONS[0];
                          return (
                            <>
                              <only.Mark className="h-3.5 w-3.5" />
                              {only.label}
                            </>
                          );
                        })()}
                      </span>
                    ) : null}

                    {!deepResearchEnabled && !chartModeEnabled && MODEL_OPTIONS.length > 1 ? (
                      <Select
                        value={selectedModel}
                        onChange={setSelectedModel}
                        label="Model"
                        placement="top"
                        size="sm"
                        panelClassName="w-64"
                        options={MODEL_OPTIONS.map((option) => ({
                          value: option.value,
                          label: option.label,
                          description: option.description,
                          icon: <option.Mark className="h-3.5 w-3.5" />,
                        }))}
                      />
                    ) : null}

                    {deepResearchEnabled ? (
                      <span className="group inline-flex h-9 items-center gap-2 rounded-full border border-sky-200 bg-sky-100 px-3 text-xs font-medium text-sky-800 dark:border-[#3a3a3a] dark:bg-[#171717] dark:text-[#f3f3f3]">
                        <SparkIcon className="h-3.5 w-3.5" />
                        Deep research
                        <button
                          type="button"
                          onClick={() => setDeepResearchEnabled(false)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-800 opacity-0 transition-opacity hover:bg-sky-200 dark:text-[#f3f3f3] dark:hover:bg-[#0a0a0a] group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label="Disable deep research"
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null}

                    {chartModeEnabled && !deepResearchEnabled ? (
                      <span className="group inline-flex h-9 items-center gap-2 rounded-full border border-sky-200 bg-sky-100 px-3 text-xs font-medium text-sky-800 dark:border-[#3a3a3a] dark:bg-[#171717] dark:text-[#f3f3f3]">
                        <ChartIcon className="h-3.5 w-3.5" />
                        Chart mode
                        <button
                          type="button"
                          onClick={() => setChartModeEnabled(false)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-800 opacity-0 transition-opacity hover:bg-sky-200 dark:text-[#f3f3f3] dark:hover:bg-[#0a0a0a] group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label="Disable chart mode"
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null}

                    {webSearchEnabled && !deepResearchEnabled ? (
                      <span className="group inline-flex h-9 items-center gap-2 rounded-full border border-sky-200 bg-sky-100 px-3 text-xs font-medium text-sky-800 dark:border-[#3a3a3a] dark:bg-[#171717] dark:text-[#f3f3f3]">
                        <SearchIcon className="h-3.5 w-3.5" />
                        Web search
                        <button
                          type="button"
                          onClick={() => setWebSearchEnabled(false)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-800 opacity-0 transition-opacity hover:bg-sky-200 dark:text-[#f3f3f3] dark:hover:bg-[#0a0a0a] group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label="Disable web search"
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null}

                    {chatScopeFolderId !== "all" ? (
                      <span className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]">
                        <FolderIcon className="h-3.5 w-3.5" />
                        {activeFolderLabel}
                      </span>
                    ) : null}
                  </div>

                  <div className="relative flex items-center gap-2" ref={parameterMenuRef}>
                    {/* The generation parameters (temperature, top P...) were removed from
                        here: answers run through the repository pipeline, which never read
                        them, so the panel changed nothing. */}
                    <button
                      type="submit"
                      disabled={
                        (!loading && draft.trim().length === 0 && !chartModeEnabled) ||
                        (deepResearchEnabled && !canPersist)
                      }
                      className={`group inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                        loading
                          ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-[#111111] dark:hover:bg-[#f3f3f3]"
                          : draft.trim().length > 0 || chartModeEnabled
                            ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-[#111111] dark:hover:bg-[#f3f3f3]"
                            : "bg-slate-200 text-slate-600 dark:bg-[#1f1f1f] dark:text-[#8e8e8e]"
                      } disabled:cursor-not-allowed`}
                      aria-label={loading ? "Stop generating" : "Send message"}
                    >
                      {loading ? (
                        <StopIcon className="h-4 w-4" />
                      ) : (
                        <SendIcon
                          className={`h-4 w-4 transition-transform duration-200 ease-out-expo ${
                            draft.trim().length > 0 || chartModeEnabled ? "group-hover:-translate-y-px group-hover:translate-x-0.5" : ""
                          }`}
                        />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </section>

        {sourcesPanelOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-black/25 lg:hidden"
              onClick={() => setSourcesPanelOpen(false)}
              aria-label="Close conversation sources"
            />
            <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(90vw,360px)] flex-col border-l border-slate-200 bg-white shadow-[-18px_0_50px_rgba(15,23,42,0.14)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:shadow-[-18px_0_50px_rgba(0,0,0,0.4)] lg:static lg:z-auto lg:w-[340px] lg:flex-none lg:shadow-none">
              <div className="flex h-14 flex-none items-center justify-between border-b border-slate-200 px-4 dark:border-[#1f1f1f]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-[#ececec]">Sources</p>
                  <p className="text-xs text-slate-600 dark:text-[#8e8e8e]">{conversationSources.length} unique sources</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSourcesPanelOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                  aria-label="Close conversation sources"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {conversationSources.length > 0 ? (
                  <div className="space-y-2">
                    {conversationSources.map((citation) => (
                      <CitationLink
                        key={`conversation-${citation.sourceType ?? "paper"}-${citation.paperId}-${citation.href}`}
                        citation={citation}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-2 py-8 text-center text-sm leading-6 text-slate-600 dark:text-[#8e8e8e]">
                    Sources cited by answers in this conversation will appear here.
                  </div>
                )}
              </div>
            </aside>
          </>
        ) : null}
      </div>

      {reportFullViewOpen && researchReport ? (
        <div
          ref={reportViewRef}
          role="dialog"
          aria-modal="true"
          aria-label="Deep research report"
          className="fixed inset-0 z-50 overscroll-contain bg-slate-50 text-slate-900 dark:bg-[#050505] dark:text-[#ececec]"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#1f1f1f] sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setReportFullViewOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#b4b4b4] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                  aria-label="Close full report"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-slate-600 dark:text-[#b4b4b4]">
                  Deep research report
                </span>
              </div>

              <button
                type="button"
                onClick={() => setReportFullViewOpen(false)}
                className="inline-flex h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-10 sm:px-10">
              <article className="mx-auto max-w-[900px] space-y-8">
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 dark:text-[#8e8e8e]">
                    Research completed in the selected library scope.
                  </p>
                  <h1 className="text-[2.2rem] font-semibold tracking-normal text-slate-900 dark:text-[#ececec] sm:text-[3rem]">
                    {researchTitle}
                  </h1>
                </div>

                {renderRichMessage(researchMarked.text, "fullscreen-report", "assistant", researchMarked.sources)}
                <ResearchSources sources={researchMarked.sources} />
              </article>
            </div>
          </div>
        </div>
      ) : null}

      {threadDialog ? (
        <Modal onClose={() => (threadDialogBusy ? undefined : setThreadDialog(null))} zIndexClassName="z-[70]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirmThreadDialog();
            }}
            className="w-[min(420px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay"
          >
            <h2 className="text-base font-semibold text-ink">
              {threadDialog.kind === "rename" ? "Rename chat" : "Delete this chat?"}
            </h2>
            {threadDialog.kind === "rename" ? (
              <label className="mt-4 block">
                <span className="sr-only">Chat name</span>
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  maxLength={200}
                  className="h-10 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-hairline-strong focus:ring-2 focus:ring-hairline"
                />
              </label>
            ) : (
              <p className="mt-2 text-sm leading-6 text-body">
                &ldquo;{threadDialog.thread.title || "Untitled chat"}&rdquo; and its messages are deleted. This cannot be undone.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setThreadDialog(null)}
                disabled={threadDialogBusy}
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-body transition-colors hover:bg-subtle hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                autoFocus={threadDialog.kind === "delete"}
                disabled={threadDialogBusy || (threadDialog.kind === "rename" && !renameDraft.trim())}
                className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-60 ${
                  threadDialog.kind === "delete" ? "bg-[#dc2626] text-white hover:bg-[#b91c1c]" : "bg-ink text-canvas hover:bg-ink/85"
                }`}
              >
                {threadDialog.kind === "rename" ? "Save" : "Delete"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {searchModalOpen ? (
        <Modal onClose={() => setSearchModalOpen(false)} zIndexClassName="z-[60]">
          <div className="flex h-[min(660px,86vh)] w-[min(860px,94vw)] flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white text-slate-900 shadow-[0_28px_80px_rgba(15,23,42,0.24)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#f4f4f4] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
            <div className="flex h-20 flex-none items-center border-b border-slate-200 px-6 dark:border-[#1f1f1f]">
              <label className="relative flex min-w-0 flex-1 items-center">
                <SearchIcon className="pointer-events-none absolute left-0 h-5 w-5 text-slate-600 dark:text-[#b4b4b4]" />
                <input
                  type="search"
                  value={chatSearchQuery}
                  onChange={(event) => setChatSearchQuery(event.target.value)}
                  placeholder="Search chats…"
                  className="w-full bg-transparent py-4 pl-8 pr-4 text-xl text-slate-900 outline-none placeholder:text-slate-600 dark:text-white dark:placeholder:text-[#c7c7c7]"
                  autoFocus
                />
              </label>
              <button
                type="button"
                onClick={() => setSearchModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#c7c7c7] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                aria-label="Close chat search"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  resetChat("normal");
                  setSearchModalOpen(false);
                }}
                className="mb-5 flex h-12 w-full items-center gap-4 rounded-xl px-1 text-left text-base font-medium text-slate-900 transition-colors hover:bg-slate-100 dark:text-white dark:hover:bg-[#0a0a0a]"
              >
                <PencilSquareIcon className="h-5 w-5" />
                <span>New chat</span>
              </button>

              {chatSearchLoading ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-white/5 dark:text-[#c7c7c7]">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-[#1f1f1f] dark:border-t-white" />
                  <span>Searching chats…</span>
                </div>
              ) : null}

              {!chatSearchLoading && chatSearchError ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
                  {chatSearchError}
                </div>
              ) : null}

              {!chatSearchLoading && !chatSearchError && chatSearchResults.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-white/5 dark:text-[#c7c7c7]">
                  {chatSearchQuery.trim()
                    ? "No chats matched that search."
                    : "No chats yet."}
                </div>
              ) : null}

              {!chatSearchLoading && !chatSearchError
                ? ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Older"].map(
                    (groupLabel) => {
                      const groupResults = chatSearchResults.filter(
                        (result) => result.groupLabel === groupLabel
                      );
                      if (groupResults.length === 0) return null;
                      return (
                        <section key={groupLabel} className="mb-6">
                          <p className="mb-2 text-sm text-slate-600 dark:text-[#b4b4b4]">
                            {groupLabel}
                          </p>
                          <div className="space-y-1">
                            {groupResults.map((result) => (
                              <button
                                key={result.id}
                                type="button"
                                onClick={() => {
                                  setActiveThreadId(result.thread.id);
                                  setSearchModalOpen(false);
                                  setThreadMenuId(null);
                                }}
                                className="flex w-full items-start gap-4 rounded-xl px-1 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-[#0a0a0a]"
                              >
                                <ChatIcon className="mt-1 h-5 w-5 flex-none text-slate-700 dark:text-white" />
                                <span className="min-w-0">
                                  <span className="block truncate text-base font-medium text-slate-900 dark:text-white">
                                    {result.thread.title || "Untitled chat"}
                                  </span>
                                  {result.snippet ? (
                                    <span className="mt-1 line-clamp-2 block text-sm leading-5 text-slate-600 dark:text-[#c7c7c7]">
                                      {result.matchedIn === "message" ? "Message: " : ""}
                                      {result.snippet}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    }
                  )
                : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {showLibraryPicker ? (
        <Modal onClose={() => setShowLibraryPicker(false)}>
          <div className="w-[min(720px,92vw)] rounded-xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.18)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-[#ececec]">
                  Add papers from repositories
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-[#8e8e8e]">
                  Choose papers from any repository in this account when you want to narrow
                  this message to specific sources.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLibraryPicker(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#8e8e8e] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                aria-label="Close library picker"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <label className="relative mt-5 block">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-[#8e8e8e]" />
              <input
                type="search"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search files…"
                aria-label="Search files"
                className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-base text-slate-900 sm:text-sm outline-none placeholder:text-slate-600 focus:border-slate-400 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#ececec] dark:placeholder:text-[#8e8e8e] dark:focus:border-white/20"
              />
            </label>

            <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {libraryLoading ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#b4b4b4]">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-[#1f1f1f] dark:border-t-white" />
                  <span>Loading repository files…</span>
                </div>
              ) : filteredLibraryRuns.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#8e8e8e]">
                  No files matched this search.
                </div>
              ) : (
                filteredLibraryRuns.map((run) => {
                  const selected = selectedRunIds.includes(run.id);
                  const Glyph = runGlyph(run);
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => toggleLibraryRun(run)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-sky-300 bg-sky-50 dark:border-[#3a3a3a] dark:bg-[#171717]/65"
                          : "border-slate-200 bg-white hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:bg-[#0a0a0a]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl ${runGlyphTone(run)}`}
                      >
                        <Glyph className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-[#ececec]">
                          {runTitleOf(run)}
                        </span>
                        <span className="mt-1 block text-xs text-slate-600 dark:text-[#8e8e8e]">
                          {runSourceLabel(run)} | {runExtOf(run).toUpperCase()}
                        </span>
                      </span>
                      <span
                        className={`mt-1 inline-flex h-5 w-5 flex-none rounded-full border ${
                          selected
                            ? "border-sky-600 bg-sky-600 dark:border-[#9cc8ff] dark:bg-[#9cc8ff]"
                            : "border-slate-300 dark:border-[#1f1f1f]"
                        }`}
                      >
                        {selected ? (
                          <CheckCircleIcon className="h-5 w-5 text-white dark:text-[#173868]" />
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-[#8e8e8e]">
                {selectedLibraryRuns.length} file
                {selectedLibraryRuns.length === 1 ? "" : "s"} selected
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLibraryPicker(false)}
                  className="inline-flex h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      <AnalyzeFlowModal
        open={showAnalyzeModal}
        onClose={() => setShowAnalyzeModal(false)}
        onCreated={handleCreatedRuns}
      />
    </>
  );
}
