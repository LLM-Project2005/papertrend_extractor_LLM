"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  CloseIcon,
  DriveIcon,
  EqualizerIcon,
  FileIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PaperIcon,
  PencilSquareIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import Modal from "@/components/ui/Modal";
import type {
  FolderAnalysisJobRow,
  IngestionRunRow,
  ResearchFolderRow,
} from "@/types/database";
import type {
  ChatMode,
  ChatThreadDetail,
  DeepResearchSessionRecord,
  WorkspaceMessageRecord,
  WorkspaceThreadSummary,
} from "@/types/research";

interface Citation {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason: string;
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
  mode?: "grounded" | "fallback";
  citations?: Citation[];
  error?: string;
  thread?: WorkspaceThreadSummary;
  messages?: WorkspaceMessageRecord[];
  deepResearchSession?: DeepResearchSessionRecord | null;
}

const PINNED_THREADS_STORAGE_KEY = "papertrend_pinned_chat_threads_v1";
const CHAT_MODEL_STORAGE_KEY = "papertrend_chat_model_v1";
const CHAT_PARAMETERS_STORAGE_KEY = "papertrend_chat_parameters_v1";

type ChatGenerationParameters = {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
};

const DEFAULT_CHAT_PARAMETERS: ChatGenerationParameters = {
  temperature: 0.4,
  topP: 0.95,
  topK: 0,
  maxTokens: 1200,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

const MODEL_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4.1-mini", label: "GPT-4.1 mini" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
] as const;

const mapMessage = (message: WorkspaceMessageRecord): MessageView => ({
  id: message.id,
  role: message.role,
  content: message.content,
  citations: message.citations ?? [],
  kind: message.message_kind,
  metadata: message.metadata ?? null,
});

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

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="font-semibold text-slate-900 dark:text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const parts = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (parts) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${match.index}`}
            href={parts[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sky-700 underline underline-offset-4 transition-colors hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200"
          >
            {parts[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${match.index}`}
          className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.95em] text-slate-800 dark:bg-white/10 dark:text-[#f3f3f3]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isMarkdownTable(lines: string[]) {
  if (lines.length < 2) {
    return false;
  }
  const separator = lines[1].trim();
  return (
    lines[0].includes("|") &&
    /^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(separator)
  );
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function groupMarkdownLines(lines: string[]) {
  const groups: string[][] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^#{1,3}\s+/.test(line)) {
      groups.push([line]);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length) {
      const tableCandidate = [line, lines[index + 1]];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].includes("|")) {
        tableCandidate.push(lines[cursor]);
        cursor += 1;
      }
      if (isMarkdownTable(tableCandidate)) {
        groups.push(tableCandidate);
        index = cursor;
        continue;
      }
    }

    if (/^[-*]\s+/.test(line)) {
      const listGroup = [line];
      index += 1;
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        listGroup.push(lines[index]);
        index += 1;
      }
      groups.push(listGroup);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listGroup = [line];
      index += 1;
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        listGroup.push(lines[index]);
        index += 1;
      }
      groups.push(listGroup);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteGroup = [line];
      index += 1;
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteGroup.push(lines[index]);
        index += 1;
      }
      groups.push(quoteGroup);
      continue;
    }

    const paragraphGroup = [line];
    index += 1;
    while (
      index < lines.length &&
      !/^#{1,3}\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index])
    ) {
      if (lines[index].includes("|") && index + 1 < lines.length) {
        const candidate = [lines[index], lines[index + 1]];
        if (isMarkdownTable(candidate)) {
          break;
        }
      }
      paragraphGroup.push(lines[index]);
      index += 1;
    }
    groups.push(paragraphGroup);
  }

  return groups;
}

function renderRichMessage(content: string, keyPrefix: string, tone: "assistant" | "user" = "assistant") {
  const normalized = content.replace(/\r\n/g, "\n");
  const blocks: string[] = [];
  const lines = normalized.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const codeLines = [line];
      index += 1;
      while (index < lines.length) {
        codeLines.push(lines[index]);
        if (lines[index].trim().startsWith("```")) {
          index += 1;
          break;
        }
        index += 1;
      }
      blocks.push(codeLines.join("\n"));
      continue;
    }

    const chunk = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (lines[index].trim().startsWith("```")) {
        break;
      }
      chunk.push(lines[index]);
      index += 1;
    }
    blocks.push(chunk.join("\n"));
  }

  const headingClass =
    tone === "assistant"
      ? "text-lg font-semibold text-slate-900 dark:text-white"
      : "text-base font-semibold text-slate-900 dark:text-[#f3f3f3]";
  const paragraphClass =
    tone === "assistant"
      ? "text-[15px] leading-7 text-slate-700 dark:text-[#ececec]"
      : "text-[15px] leading-7 text-slate-800 dark:text-[#f3f3f3]";

  return (
    <div className="space-y-4">
      {blocks.map((block, blockIndex) => {
        const rawLines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (rawLines.length === 0) {
          return null;
        }

        if (block.trim().startsWith("```")) {
          const rawLines = block.split("\n");
          const fence = rawLines[0].trim();
          const language = fence.replace(/^```/, "").trim();
          const code = rawLines
            .slice(1, rawLines[rawLines.length - 1]?.trim().startsWith("```") ? -1 : undefined)
            .join("\n");
          return (
            <div
              key={`${keyPrefix}-codeblock-${blockIndex}`}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-[#181818]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:text-[#8e8e8e]">
                <span>{language || "Code"}</span>
              </div>
              <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-slate-700 dark:text-[#e6e6e6]">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        return (
          <div key={`${keyPrefix}-block-${blockIndex}`} className="space-y-4">
            {groupMarkdownLines(rawLines).map((lines, groupIndex) => {
              if (isMarkdownTable(lines)) {
                const header = parseMarkdownTableRow(lines[0]);
                const rows = lines.slice(2).map(parseMarkdownTableRow).filter((row) => row.length > 0);
                return (
                  <div
                    key={`${keyPrefix}-table-${blockIndex}-${groupIndex}`}
                    className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#222222]"
                  >
                    <table className="min-w-full border-collapse text-left text-sm text-slate-700 dark:text-[#ececec]">
                      <thead className="bg-slate-100 dark:bg-white/5">
                        <tr>
                          {header.map((cell, cellIndex) => (
                            <th
                              key={`${keyPrefix}-th-${blockIndex}-${groupIndex}-${cellIndex}`}
                              className="border-b border-slate-200 px-4 py-3 font-semibold dark:border-white/10"
                            >
                              {renderInlineMarkdown(cell, `${keyPrefix}-th-${blockIndex}-${groupIndex}-${cellIndex}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, rowIndex) => (
                          <tr key={`${keyPrefix}-tr-${blockIndex}-${groupIndex}-${rowIndex}`} className="border-t border-slate-200 dark:border-white/10">
                            {row.map((cell, cellIndex) => (
                              <td
                                key={`${keyPrefix}-td-${blockIndex}-${groupIndex}-${rowIndex}-${cellIndex}`}
                                className="px-4 py-3 align-top text-slate-600 dark:text-[#d8d8d8]"
                              >
                                {renderInlineMarkdown(cell, `${keyPrefix}-td-${blockIndex}-${groupIndex}-${rowIndex}-${cellIndex}`)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
              if (bulletLines.length === lines.length) {
                return (
                  <ul
                    key={`${keyPrefix}-list-${blockIndex}-${groupIndex}`}
                    className={`space-y-2 ${paragraphClass}`}
                  >
                    {bulletLines.map((line, lineIndex) => (
                      <li key={`${keyPrefix}-item-${blockIndex}-${groupIndex}-${lineIndex}`} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-slate-400 dark:bg-white/60" />
                        <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""), `${keyPrefix}-${blockIndex}-${groupIndex}-${lineIndex}`)}</span>
                      </li>
                    ))}
                  </ul>
                );
              }

              const numberedLines = lines.filter((line) => /^\d+\.\s+/.test(line));
              if (numberedLines.length === lines.length) {
                return (
                  <ol
                    key={`${keyPrefix}-ordered-${blockIndex}-${groupIndex}`}
                    className={`space-y-2 ${paragraphClass}`}
                  >
                    {numberedLines.map((line, lineIndex) => (
                      <li key={`${keyPrefix}-ordered-item-${blockIndex}-${groupIndex}-${lineIndex}`} className="flex gap-3">
                        <span className="min-w-[1.5rem] flex-none font-semibold text-slate-500 dark:text-white/75">
                          {line.match(/^(\d+)\./)?.[1]}.
                        </span>
                        <span>{renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""), `${keyPrefix}-ordered-${blockIndex}-${groupIndex}-${lineIndex}`)}</span>
                      </li>
                    ))}
                  </ol>
                );
              }

              const quoteLines = lines.filter((line) => /^>\s?/.test(line));
              if (quoteLines.length === lines.length) {
                return (
                  <blockquote
                    key={`${keyPrefix}-quote-${blockIndex}-${groupIndex}`}
                    className="rounded-r-2xl border-l-4 border-sky-500/70 bg-sky-50 px-4 py-3 text-[15px] leading-7 text-sky-900 dark:border-sky-400/70 dark:bg-white/5 dark:text-[#d9e9ff]"
                  >
                    <div className="space-y-2">
                      {quoteLines.map((line, lineIndex) => (
                        <p key={`${keyPrefix}-quote-line-${blockIndex}-${groupIndex}-${lineIndex}`}>
                          {renderInlineMarkdown(line.replace(/^>\s?/, ""), `${keyPrefix}-quote-${blockIndex}-${groupIndex}-${lineIndex}`)}
                        </p>
                      ))}
                    </div>
                  </blockquote>
                );
              }

              if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
                const headingText = lines[0].replace(/^#{1,3}\s+/, "");
                return (
                  <h3 key={`${keyPrefix}-heading-${blockIndex}-${groupIndex}`} className={headingClass}>
                    {renderInlineMarkdown(headingText, `${keyPrefix}-heading-${blockIndex}-${groupIndex}`)}
                  </h3>
                );
              }

              return (
                <p key={`${keyPrefix}-paragraph-${blockIndex}-${groupIndex}`} className={paragraphClass}>
                  {renderInlineMarkdown(lines.join(" "), `${keyPrefix}-paragraph-${blockIndex}-${groupIndex}`)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
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
  if (!folderId || folderId === "all") return "All folders";
  return folders.find((folder) => folder.id === folderId)?.name ?? "Selected folder";
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
    return "bg-red-500/15 text-red-300";
  }
  if (ext === "doc" || ext === "docx") {
    return "bg-blue-500/15 text-blue-300";
  }
  return "bg-white/10 text-[#d4d4d4]";
}

function renderLoadingLabel(
  deepResearchEnabled: boolean,
  activeSession?: DeepResearchSessionRecord | null
) {
  if (!deepResearchEnabled) return "Generating answer...";
  if (activeSession?.status === "planned") return "Planning deep research...";
  if (activeSession?.status === "waiting_on_analysis") return "Waiting for folder analysis...";
  return "Running deep research...";
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

function splitReportBlocks(report?: string | null) {
  return String(report || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
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
    currentProject,
    selectedProjectId,
    selectedYears,
    selectedTracks,
    searchQuery,
    startAnalysisSession,
    refreshFolders,
  } = useWorkspaceProfile();
  const [chatScopeFolderId, setChatScopeFolderId] = useState<string>("all");
  const [selectedModel, setSelectedModel] = useState("");
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [parameterMenuOpen, setParameterMenuOpen] = useState(false);
  const [chatParameters, setChatParameters] = useState<ChatGenerationParameters>(
    DEFAULT_CHAT_PARAMETERS
  );
  const projectFolderIds = useMemo(
    () => folders.map((folder) => folder.id),
    [folders]
  );
  const { allYears } = useDashboardData(chatScopeFolderId, projectFolderIds, {
    projectId: selectedProjectId,
  });
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<WorkspaceThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<WorkspaceThreadSummary | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [deepSession, setDeepSession] = useState<DeepResearchSessionRecord | null>(null);
  const [libraryRuns, setLibraryRuns] = useState<IngestionRunRow[]>([]);
  const [selectedLibraryRuns, setSelectedLibraryRuns] = useState<IngestionRunRow[]>([]);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [reportFullViewOpen, setReportFullViewOpen] = useState(false);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const parameterMenuRef = useRef<HTMLDivElement | null>(null);

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
  const selectedRunIds = useMemo(
    () => selectedLibraryRuns.map((run) => run.id),
    [selectedLibraryRuns]
  );
  const selectedAttachments = useMemo(
    () =>
      selectedLibraryRuns.map((run) => ({
        name: runTitleOf(run),
        type: run.mime_type || runExtOf(run),
        size: run.file_size_bytes ?? undefined,
      })),
    [selectedLibraryRuns]
  );
  const activeFolderLabel = useMemo(
    () => buildFolderLabel(chatScopeFolderId, folders),
    [chatScopeFolderId, folders]
  );
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
  const researchReport = useMemo(
    () => {
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
    [deepSession, messages]
  );
  const researchBlocks = useMemo(
    () => splitReportBlocks(researchReport),
    [researchReport]
  );
  const visibleMessages = useMemo(
    () =>
      researchReport
        ? messages.filter((message) => message.kind !== "deep_research_report")
        : messages,
    [messages, researchReport]
  );
  const researchProgress = useMemo(
    () => buildResearchProgress(deepSession),
    [deepSession]
  );
  const hasContent = visibleMessages.length > 0 || Boolean(deepSession);

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
      setSelectedModel(window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY) ?? "");
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
    }
  }, [deepResearchEnabled]);

  useEffect(() => {
    resizeComposer();
  }, [draft, resizeComposer]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deepSession?.status, loading, messages]);

  useEffect(() => {
    if (deepSession?.status !== "completed") {
      setReportFullViewOpen(false);
    }
  }, [deepSession?.id, deepSession?.status]);

  const resetChat = useCallback(
    (mode: ChatMode = deepResearchEnabled ? "deep_research" : "normal") => {
      setActiveThreadId(null);
      setActiveThread(null);
      setMessages([]);
      setDeepSession(null);
      setSelectedLibraryRuns([]);
      setError(null);
      setThreadMenuId(null);
      setReportFullViewOpen(false);
      setDeepResearchEnabled(mode === "deep_research");
    },
    [deepResearchEnabled]
  );

  const applyPayload = useCallback((payload: ChatPayload) => {
    if (payload.thread) {
      setActiveThread(payload.thread);
      setActiveThreadId(payload.thread.id);
      setDeepResearchEnabled(payload.thread.mode === "deep_research");
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
        const response = await fetch("/api/chat/threads", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await response.json()) as {
          threads?: WorkspaceThreadSummary[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load chat history.");
        }
        const nextThreads = payload.threads ?? [];
        setThreads(nextThreads);
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
    async (threadId: string) => {
      if (!canPersist || !session?.access_token) return;
      setDetailLoading(true);
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
        setActiveThread(payload.thread);
        setDeepResearchEnabled(payload.thread.mode === "deep_research");
        setMessages(
          (payload.messages ?? [])
            .filter((message) => message.message_kind !== "deep_research_plan")
            .map(mapMessage)
        );
        setDeepSession(payload.deepResearchSession ?? null);
        if (payload.thread.mode === "deep_research") {
          setChatScopeFolderId(payload.deepResearchSession?.folder_id ?? "all");
        }
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Failed to load chat thread."
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [canPersist, session?.access_token]
  );

  const loadLibraryRuns = useCallback(async () => {
    if (!canPersist || !selectedProjectId) {
      setLibraryRuns([]);
      return;
    }

    setLibraryLoading(true);
    try {
      const response = await fetch(
        `/api/workspace/library?projectId=${encodeURIComponent(selectedProjectId)}`,
        {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }
      );
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
  }, [canPersist, selectedProjectId, session?.access_token]);

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

  useEffect(() => {
    if (!canPersist || !activeThreadId || !sessionActive(deepSession)) return;
    const timer = window.setInterval(() => {
      void loadThreadDetail(activeThreadId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, canPersist, deepSession, loadThreadDetail]);

  useEffect(() => {
    if (!showLibraryPicker) return;
    void loadLibraryRuns();
  }, [loadLibraryRuns, showLibraryPicker]);

  useEffect(() => {
    setSelectedLibraryRuns([]);
    setLibraryRuns([]);
    setLibraryQuery("");
  }, [selectedProjectId]);

  async function sendRequest(body: Record<string, unknown>) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json()) as ChatPayload;
    if (!response.ok) {
      throw new Error(payload.error ?? "Chat request failed.");
    }
    return payload;
  }

  function stopGenerating() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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

  async function handleNormalSend() {
    const prompt = draft.trim();
    if (!prompt) return;

    setLoading(true);
    setError(null);
    setMenuOpen(false);

    const nextMessages = [...messages, localMessage("user", prompt)];
    setMessages(nextMessages);
    setDraft("");

    try {
      const payload = await sendRequest({
        message: prompt,
        model: selectedModel || undefined,
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
        folderId: chatScopeFolderId,
        projectId: selectedProjectId ?? undefined,
        selectedRunIds,
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

  function handleParameterChange<K extends keyof ChatGenerationParameters>(
    key: K,
    value: ChatGenerationParameters[K]
  ) {
    setChatParameters((current) => ({
      ...current,
      [key]: value,
    }));
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
    const optimisticMessages = [...messages, localMessage("user", prompt)];
    setMessages(optimisticMessages);
    setDraft("");

    try {
      const payload = await sendRequest({
        message: prompt,
        attachments: selectedAttachments,
        folderId: chatScopeFolderId,
        projectId: selectedProjectId ?? undefined,
        selectedRunIds,
        threadId: activeThread?.mode === "deep_research" ? activeThread.id : undefined,
        sessionId:
          activeThread?.mode === "deep_research" ? deepSession?.id : undefined,
        chatMode: "deep_research",
        action: "plan",
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
    setError(null);
    try {
      const payload = await sendRequest({
        folderId: chatScopeFolderId,
        projectId: selectedProjectId ?? undefined,
        selectedRunIds,
        threadId: activeThread.id,
        sessionId: deepSession.id,
        chatMode: "deep_research",
        action: "continue",
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
    }
  }

  function handleEditResearchPlan() {
    setDeepResearchEnabled(true);
    focusComposerWithDraft(deepSession?.prompt ?? "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) {
      stopGenerating();
      return;
    }
    if (deepResearchEnabled) {
      await handlePlanResearch();
      return;
    }
    await handleNormalSend();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function renameThread(thread: WorkspaceThreadSummary) {
    if (!canPersist || !session?.access_token) return;
    const nextTitle = window.prompt("Rename chat", thread.title)?.trim();
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

  async function deleteThread(thread: WorkspaceThreadSummary) {
    if (!canPersist || !session?.access_token) return;
    if (!window.confirm(`Delete "${thread.title}"?`)) return;

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
    void refreshFolders();
  }

  return (
    <>
      <div className="flex min-h-[calc(100vh-5rem)] w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-[#161719] dark:text-[#ececec]">
        <aside className="hidden w-[288px] flex-none border-r border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#121214] lg:flex lg:flex-col">
          <button
            type="button"
            onClick={() => resetChat("normal")}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-white/10 dark:text-[#ececec] dark:hover:bg-[#212121]"
          >
            <PencilSquareIcon className="h-4 w-4" />
            <span>New chat</span>
          </button>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="px-1">
              <p className="text-sm font-medium text-slate-800 dark:text-[#ececec]">Your chats</p>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {threadsLoading ? (
                <div className="rounded-xl px-3 py-3 text-sm text-slate-500 dark:text-[#8e8e8e]">
                  Loading...
                </div>
              ) : null}

              {!threadsLoading && sortedThreads.length === 0 ? (
                <div className="rounded-xl px-3 py-3 text-sm text-slate-500 dark:text-[#8e8e8e]">
                  {canPersist ? "No chats yet." : "Sign in to save chats."}
                </div>
              ) : null}

              {sortedThreads.map((thread) => {
                const active = thread.id === activeThreadId;
                const pinned = pinnedThreadIds.includes(thread.id);
                return (
                  <div
                    key={thread.id}
                    className={`group relative rounded-xl px-2 py-1 ${
                      active
                        ? "bg-slate-200 dark:bg-[#2a2a2a]"
                        : "hover:bg-slate-100 dark:hover:bg-[#212121]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveThreadId(thread.id);
                        setThreadMenuId(null);
                      }}
                      className="block w-full min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2">
                        {pinned ? (
                          <PinIcon className="h-3.5 w-3.5 flex-none text-slate-500 dark:text-[#8e8e8e]" />
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
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-900 dark:text-[#8e8e8e] dark:hover:bg-[#303030] dark:hover:text-white group-hover:opacity-100"
                    >
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </button>

                    {threadMenuId === thread.id ? (
                      <div className="absolute right-2 top-9 z-20 w-40 rounded-xl border border-white/10 bg-[#2a2a2a] p-1 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                        <button
                          type="button"
                          onClick={() => {
                            togglePinnedThread(thread.id);
                            setThreadMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#ececec] transition-colors hover:bg-[#303030]"
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
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#ececec] transition-colors hover:bg-[#303030]"
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
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-950/20"
                        >
                          <TrashIcon className="h-4 w-4" />
                          <span>Delete</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col bg-slate-100 dark:bg-[#161719]">
          <header className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-white/8 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => resetChat("normal")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 dark:border-white/10 dark:text-[#ececec] lg:hidden"
              >
                <PencilSquareIcon className="h-4 w-4" />
              </button>
              <p className="truncate text-lg font-semibold text-slate-900 dark:text-[#ececec]">
                {pageTitle}
              </p>
            </div>

            {deepSession ? (
              <span className="inline-flex h-9 items-center rounded-full border border-white/10 bg-[#2a2a2a] px-3 text-sm text-[#b4b4b4]">
                {sessionLabel(deepSession) ?? "Saved"}
              </span>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-48 pt-8 sm:px-6 xl:px-8">
            {deepSession ? (
              <section className="mx-auto mb-6 w-full max-w-[1040px]">
                {deepSession.status === "completed" && researchReport ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#b4b4b4]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Research completed</span>
                        <span className="text-white/20">·</span>
                        <span>
                          {researchProgress.completedSteps}/{Math.max(
                            researchProgress.totalSteps,
                            researchProgress.completedSteps
                          )}{" "}
                          steps
                        </span>
                        {deepSession.folder_id ? (
                          <>
                            <span className="text-white/20">·</span>
                            <span>{buildFolderLabel(deepSession.folder_id, folders)}</span>
                          </>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setReportFullViewOpen(true)}
                        className="inline-flex h-10 items-center rounded-full border border-white/10 bg-[#2a2a2a] px-4 text-sm font-medium text-[#ececec] transition-colors hover:bg-[#303030]"
                      >
                        Full view
                      </button>
                    </div>

                    <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[#111111] shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
                      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[#1d4ed8] text-white">
                            <SparkIcon className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-[#ececec]">
                              {researchTitle}
                            </p>
                            <p className="text-xs text-[#8e8e8e]">
                              Deep research report
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReportFullViewOpen(true)}
                          className="inline-flex h-9 items-center rounded-full border border-white/10 px-3 text-xs font-medium text-[#b4b4b4] transition-colors hover:bg-[#1f1f1f] hover:text-white"
                        >
                          Expand
                        </button>
                      </div>

                      <article className="space-y-5 px-6 py-7 sm:px-10 sm:py-10">
                        <h2 className="text-[2rem] font-semibold tracking-tight text-[#ececec] sm:text-[2.6rem]">
                          {researchTitle}
                        </h2>
                        <div className="space-y-5">
                          {(researchBlocks.length > 0
                            ? researchBlocks.slice(0, 6)
                            : [researchReport]
                          ).map((block, index) => (
                            <p
                              key={`${deepSession.id}-report-${index}`}
                              className="whitespace-pre-wrap text-[15px] leading-8 text-[#ececec]"
                            >
                              {block}
                            </p>
                          ))}
                        </div>
                        {researchBlocks.length > 6 ? (
                          <div className="rounded-2xl border border-white/10 bg-[#171717] px-4 py-3 text-sm text-[#b4b4b4]">
                            Continue in full view to read the rest of the report.
                          </div>
                        ) : null}
                      </article>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-[#171717] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-[#1d4ed8] text-white">
                            <SparkIcon className="h-4 w-4" />
                          </span>
                          <p className="text-[1.35rem] font-semibold tracking-tight text-[#ececec]">
                            {researchTitle}
                          </p>
                          {deepSession.folder_id ? (
                            <span className="rounded-full border border-white/10 bg-[#212121] px-3 py-1 text-xs font-medium text-[#b4b4b4]">
                              {buildFolderLabel(deepSession.folder_id, folders)}
                            </span>
                          ) : null}
                        </div>
                        {deepSession.plan_summary ? (
                          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#b4b4b4]">
                            {deepSession.plan_summary}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        {deepSession.status === "planned" ? (
                          <>
                            <button
                              type="button"
                              onClick={handleEditResearchPlan}
                              className="inline-flex h-11 items-center rounded-full border border-white/10 px-4 text-sm font-medium text-[#ececec] transition-colors hover:bg-[#242424]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => resetChat("deep_research")}
                              className="inline-flex h-11 items-center rounded-full border border-white/10 px-4 text-sm font-medium text-[#b4b4b4] transition-colors hover:bg-[#242424] hover:text-white"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleContinueResearch()}
                              disabled={loading}
                              className="inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#f1f1f1] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Start
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={handleEditResearchPlan}
                            className="inline-flex h-11 items-center rounded-full border border-white/10 px-4 text-sm font-medium text-[#ececec] transition-colors hover:bg-[#242424]"
                          >
                            Update
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
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
                        return (
                          <div
                            key={step.id}
                            className="flex items-start gap-4 text-left"
                          >
                            <span
                              className={`mt-1 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full ${
                                isComplete
                                  ? "bg-white text-[#111111]"
                                  : isProcessing
                                    ? "border border-white bg-transparent text-white"
                                    : isBlocked
                                      ? "border border-amber-400/60 bg-amber-500/10 text-amber-200"
                                    : isPending
                                      ? "border border-white/20 bg-transparent text-transparent"
                                      : "border border-red-400/50 bg-red-500/10 text-red-300"
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
                                <p className="text-[15px] leading-7 text-[#ececec]">
                                  {step.title}
                                </p>
                                {isAppended ? (
                                  <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-blue-200">
                                    Added
                                  </span>
                                ) : null}
                                {isObsolete ? (
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#b4b4b4]">
                                    Obsolete
                                  </span>
                                ) : null}
                                {isBlocked ? (
                                  <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-200">
                                    Waiting on recovery
                                  </span>
                                ) : null}
                                {isFailed ? (
                                  <span className="rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-red-200">
                                    Failed
                                  </span>
                                ) : null}
                              </div>
                              {stepBody ? (
                                <p className="text-sm leading-6 text-[#b4b4b4]">
                                  {stepBody}
                                </p>
                              ) : null}
                              {statusReason ? (
                                <p className="text-xs leading-5 text-[#8e8e8e]">
                                  {statusReason}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {deepSession.status !== "planned" ? (
                      <div className="mt-6">
                        <div className="flex items-center justify-between gap-3 text-sm text-[#b4b4b4]">
                          <span>{researchProgress.detail}</span>
                          <span>
                            {researchProgress.completedSteps}/{Math.max(
                              researchProgress.totalSteps,
                              researchProgress.completedSteps
                            )}{" "}
                            steps
                          </span>
                        </div>
                        <div className="mt-3 h-2.5 rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-white transition-[width] duration-500"
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
                      <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {deepSession.last_error}
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}

            {!hasContent && !loading ? (
              <div className="flex min-h-[52vh] items-center justify-center">
                <h1 className="text-center text-[2rem] font-semibold tracking-tight text-slate-900 dark:text-[#ececec] sm:text-[2.5rem]">
                  Where should we begin?
                </h1>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-7">
                {visibleMessages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <section key={message.id}>
                      {isUser ? (
                        <div className="flex justify-end">
                          <div className="max-w-[72%] rounded-[18px] bg-[#2a2a2a] px-5 py-3 text-[15px] leading-7 text-[#f3f3f3]">
                            {renderRichMessage(message.content, message.id, "user")}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {renderRichMessage(message.content, message.id, "assistant")}
                          {message.citations.length > 0 ? (
                            <div className="space-y-2">
                              {message.citations.map((citation) => (
                                <Link
                                  key={`${message.id}-${citation.paperId}`}
                                  href={citation.href}
                                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-[#2a2a2a] px-4 py-3 text-sm transition-colors hover:bg-[#303030]"
                                >
                                  <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-[#8e8e8e]" />
                                  <span className="min-w-0">
                                    <span className="font-medium text-[#ececec]">
                                      [Paper {citation.paperId}] {citation.title}
                                    </span>
                                    <span className="ml-2 text-[#8e8e8e]">
                                      ({citation.year})
                                    </span>
                                    {citation.reason ? (
                                      <span className="mt-1 block text-xs leading-5 text-[#8e8e8e]">
                                        {citation.reason}
                                      </span>
                                    ) : null}
                                  </span>
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </section>
                  );
                })}

                {loading ? (
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-white/20 dark:border-t-white" />
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-[#2a2a2a] dark:text-[#b4b4b4]">
                      {renderLoadingLabel(deepResearchEnabled, deepSession)}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {detailLoading ? (
              <div className="mx-auto mt-4 flex w-full max-w-[1040px] items-center gap-3 text-sm text-slate-500 dark:text-[#8e8e8e]">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <span>Loading chat...</span>
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-6 sm:px-6 xl:px-8">
            <form onSubmit={handleSubmit} className="pointer-events-auto mx-auto w-full max-w-[1040px]">
              <div className="rounded-[28px] border border-slate-200 bg-white px-4 pb-3 pt-3 shadow-[0_10px_34px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-[#2a2a2a] dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                {error ? (
                  <div className="mb-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
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
                          className="group inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[#212121] px-3 text-xs text-[#d4d4d4]"
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
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#8e8e8e] opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100"
                            aria-label={`Remove ${runTitleOf(run)}`}
                          >
                            <CloseIcon className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Ask anything"
                  rows={1}
                  className="max-h-[220px] min-h-[28px] w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-[16px] leading-7 text-slate-900 outline-none placeholder:text-slate-400 dark:text-[#ececec] dark:placeholder:text-[#8e8e8e]"
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuOpen((current) => !current)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#ececec] transition-colors hover:bg-[#303030]"
                      >
                        <PlusIcon className="h-5 w-5" />
                      </button>

                      {menuOpen ? (
                        <div className="absolute bottom-12 left-0 z-30 w-72 rounded-2xl border border-white/10 bg-[#2a2a2a] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                          <button
                            type="button"
                            onClick={() => {
                              setShowLibraryPicker(true);
                              setMenuOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#ececec] transition-colors hover:bg-[#303030]"
                          >
                            <span className="flex items-center gap-3">
                              <FileIcon className="h-4 w-4" />
                              <span>Add from library</span>
                            </span>
                            {selectedLibraryRuns.length > 0 ? (
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-[#ececec]">
                                {selectedLibraryRuns.length}
                              </span>
                            ) : null}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setShowAnalyzeModal(true);
                              setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#ececec] transition-colors hover:bg-[#303030]"
                          >
                            <PaperIcon className="h-4 w-4" />
                            <span>Upload files</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setDeepResearchEnabled((current) => !current);
                              setMenuOpen(false);
                            }}
                            className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                              deepResearchEnabled
                                ? "bg-[#173868] text-[#9cc8ff]"
                                : "text-[#ececec] hover:bg-[#303030]"
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <SparkIcon className="h-4 w-4" />
                              <span>Deep research</span>
                            </span>
                            {deepResearchEnabled ? (
                              <span className="rounded-full bg-[#2b5da8] px-2 py-0.5 text-[11px] font-medium text-white">
                                Active
                              </span>
                            ) : null}
                          </button>

                          <div className="mt-2 border-t border-white/10 pt-2">
                            <div className="flex items-center justify-between px-3 pb-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8e8e8e]">
                                Folder scope
                              </span>
                              <span className="inline-flex items-center gap-1 text-xs text-[#b4b4b4]">
                                <FolderIcon className="h-3.5 w-3.5" />
                                {activeFolderLabel}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setChatScopeFolderId("all");
                                setMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                                chatScopeFolderId === "all"
                                  ? "bg-[#303030] text-white"
                                  : "text-[#ececec] hover:bg-[#303030]"
                              }`}
                            >
                              <span>All folders</span>
                              {chatScopeFolderId === "all" ? (
                                <ChevronDownIcon className="h-3.5 w-3.5 rotate-[-90deg]" />
                              ) : null}
                            </button>
                            <div className="mt-1 max-h-52 space-y-1 overflow-y-auto">
                              {folders.map((folder) => {
                                const active = folder.id === chatScopeFolderId;
                                return (
                                  <button
                                    key={folder.id}
                                    type="button"
                                    onClick={() => {
                                      setChatScopeFolderId(folder.id);
                                      setMenuOpen(false);
                                    }}
                                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                                      active
                                        ? "bg-[#303030] text-white"
                                        : "text-[#ececec] hover:bg-[#303030]"
                                    }`}
                                  >
                                    <span className="truncate">{folder.name}</span>
                                    {active ? (
                                      <ChevronDownIcon className="h-3.5 w-3.5 rotate-[-90deg]" />
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {!deepResearchEnabled ? (
                      <label className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[#212121] px-3 text-xs text-[#b4b4b4]">
                        <span>Model</span>
                        <select
                          value={selectedModel}
                          onChange={(event) => setSelectedModel(event.target.value)}
                          className="bg-transparent text-xs font-medium text-[#ececec] outline-none"
                        >
                          {MODEL_OPTIONS.map((option) => (
                            <option key={option.value || "auto"} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {deepResearchEnabled ? (
                      <span className="group inline-flex h-9 items-center gap-2 rounded-full border border-[#2b5da8] bg-[#173868] px-3 text-xs font-medium text-[#9cc8ff]">
                        <SparkIcon className="h-3.5 w-3.5" />
                        Deep research
                        <button
                          type="button"
                          onClick={() => setDeepResearchEnabled(false)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9cc8ff] opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                          aria-label="Disable deep research"
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null}

                    {chatScopeFolderId !== "all" ? (
                      <span className="inline-flex h-9 items-center gap-1 rounded-full border border-white/10 bg-[#212121] px-3 text-xs text-[#b4b4b4]">
                        <FolderIcon className="h-3.5 w-3.5" />
                        {activeFolderLabel}
                      </span>
                    ) : null}
                  </div>

                  <div className="relative flex items-center gap-2" ref={parameterMenuRef}>
                    {!deepResearchEnabled ? (
                      <button
                        type="button"
                        onClick={() => setParameterMenuOpen((current) => !current)}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                          parameterMenuOpen
                            ? "border-white/30 bg-[#2a2a2a] text-white"
                            : "border-white/10 bg-[#212121] text-[#b4b4b4] hover:bg-[#2a2a2a]"
                        }`}
                        aria-label="Open generation parameters"
                        title="Generation parameters"
                      >
                        <EqualizerIcon className="h-4 w-4" />
                      </button>
                    ) : null}

                    {parameterMenuOpen && !deepResearchEnabled ? (
                      <div className="absolute bottom-14 right-0 z-30 w-[320px] rounded-2xl border border-white/10 bg-[#1b1b1b] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9b9b9b]">
                            Generation
                          </p>
                          <button
                            type="button"
                            onClick={() => setChatParameters(DEFAULT_CHAT_PARAMETERS)}
                            className="text-xs font-medium text-[#9cc8ff] hover:text-[#c9e2ff]"
                          >
                            Reset
                          </button>
                        </div>

                        <div className="space-y-3 text-xs text-[#d8d8d8]">
                          <label className="block">
                            <div className="mb-1 flex items-center justify-between">
                              <span>Temperature</span>
                              <span className="text-[#9b9b9b]">{chatParameters.temperature.toFixed(2)}</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={2}
                              step={0.05}
                              value={chatParameters.temperature}
                              onChange={(event) =>
                                handleParameterChange("temperature", Number(event.target.value))
                              }
                              className="w-full accent-[#9cc8ff]"
                            />
                          </label>

                          <label className="block">
                            <div className="mb-1 flex items-center justify-between">
                              <span>Top P</span>
                              <span className="text-[#9b9b9b]">{chatParameters.topP.toFixed(2)}</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={chatParameters.topP}
                              onChange={(event) =>
                                handleParameterChange("topP", Number(event.target.value))
                              }
                              className="w-full accent-[#9cc8ff]"
                            />
                          </label>

                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="mb-1 block">Top K</span>
                              <input
                                type="number"
                                min={0}
                                max={200}
                                step={1}
                                value={chatParameters.topK}
                                onChange={(event) =>
                                  handleParameterChange("topK", Number(event.target.value || 0))
                                }
                                className="w-full rounded-lg border border-white/10 bg-[#242424] px-2 py-1.5 text-sm text-[#ececec] outline-none focus:border-[#9cc8ff]"
                              />
                            </label>

                            <label className="block">
                              <span className="mb-1 block">Max Tokens</span>
                              <input
                                type="number"
                                min={64}
                                max={8192}
                                step={1}
                                value={chatParameters.maxTokens}
                                onChange={(event) =>
                                  handleParameterChange("maxTokens", Number(event.target.value || 0))
                                }
                                className="w-full rounded-lg border border-white/10 bg-[#242424] px-2 py-1.5 text-sm text-[#ececec] outline-none focus:border-[#9cc8ff]"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="mb-1 block">Frequency Penalty</span>
                              <input
                                type="number"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={chatParameters.frequencyPenalty}
                                onChange={(event) =>
                                  handleParameterChange(
                                    "frequencyPenalty",
                                    Number(event.target.value || 0)
                                  )
                                }
                                className="w-full rounded-lg border border-white/10 bg-[#242424] px-2 py-1.5 text-sm text-[#ececec] outline-none focus:border-[#9cc8ff]"
                              />
                            </label>

                            <label className="block">
                              <span className="mb-1 block">Presence Penalty</span>
                              <input
                                type="number"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={chatParameters.presencePenalty}
                                onChange={(event) =>
                                  handleParameterChange(
                                    "presencePenalty",
                                    Number(event.target.value || 0)
                                  )
                                }
                                className="w-full rounded-lg border border-white/10 bg-[#242424] px-2 py-1.5 text-sm text-[#ececec] outline-none focus:border-[#9cc8ff]"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={
                        (!loading && draft.trim().length === 0) ||
                        (deepResearchEnabled && !canPersist)
                      }
                      className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                        loading
                          ? "bg-white text-[#111111] hover:bg-[#f3f3f3]"
                          : draft.trim().length > 0
                            ? "bg-white text-[#111111] hover:bg-[#f3f3f3]"
                            : "bg-[#3a3a3a] text-[#8e8e8e]"
                      } disabled:cursor-not-allowed`}
                      aria-label={loading ? "Stop generating" : "Send message"}
                    >
                      {loading ? (
                        <StopIcon className="h-4 w-4" />
                      ) : (
                        <SendIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>

      {reportFullViewOpen && researchReport ? (
        <div className="fixed inset-0 z-50 bg-[#171717]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setReportFullViewOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#b4b4b4] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                  aria-label="Close full report"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-[#b4b4b4]">
                  Deep research report
                </span>
              </div>

              <button
                type="button"
                onClick={() => setReportFullViewOpen(false)}
                className="inline-flex h-10 items-center rounded-full border border-white/10 px-4 text-sm font-medium text-[#ececec] transition-colors hover:bg-[#2a2a2a]"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-10 sm:px-10">
              <article className="mx-auto max-w-[900px] space-y-8">
                <div className="space-y-3">
                  <p className="text-sm text-[#8e8e8e]">
                    Research completed in the selected library scope.
                  </p>
                  <h1 className="text-[2.2rem] font-semibold tracking-tight text-[#ececec] sm:text-[3rem]">
                    {researchTitle}
                  </h1>
                </div>

                <div className="space-y-6">
                  {(researchBlocks.length > 0 ? researchBlocks : [researchReport]).map(
                    (block, index) => (
                      <p
                        key={`fullscreen-report-${index}`}
                        className="whitespace-pre-wrap text-[17px] leading-9 text-[#ececec]"
                      >
                        {block}
                      </p>
                    )
                  )}
                </div>
              </article>
            </div>
          </div>
        </div>
      ) : null}

      {showLibraryPicker ? (
        <Modal onClose={() => setShowLibraryPicker(false)}>
          <div className="w-[min(720px,92vw)] rounded-[28px] border border-white/10 bg-[#171717] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#ececec]">
                  Add from library
                </h2>
                <p className="mt-1 text-sm text-[#8e8e8e]">
                  Choose files from {currentProject?.name ?? "this project"} to focus the
                  chat context.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLibraryPicker(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#8e8e8e] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                aria-label="Close library picker"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <label className="relative mt-5 block">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e8e]" />
              <input
                type="search"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search files"
                className="w-full rounded-2xl border border-white/10 bg-[#212121] py-3 pl-11 pr-4 text-sm text-[#ececec] outline-none placeholder:text-[#8e8e8e] focus:border-white/20"
              />
            </label>

            <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {libraryLoading ? (
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#212121] px-4 py-4 text-sm text-[#b4b4b4]">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  <span>Loading library files...</span>
                </div>
              ) : filteredLibraryRuns.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#212121] px-4 py-5 text-sm text-[#8e8e8e]">
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
                      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-[#2b5da8] bg-[#173868]/65"
                          : "border-white/10 bg-[#212121] hover:bg-[#262626]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-10 w-10 flex-none items-center justify-center rounded-2xl ${runGlyphTone(run)}`}
                      >
                        <Glyph className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#ececec]">
                          {runTitleOf(run)}
                        </span>
                        <span className="mt-1 block text-xs text-[#8e8e8e]">
                          {runSourceLabel(run)} | {runExtOf(run).toUpperCase()}
                        </span>
                      </span>
                      <span
                        className={`mt-1 inline-flex h-5 w-5 flex-none rounded-full border ${
                          selected
                            ? "border-[#9cc8ff] bg-[#9cc8ff]"
                            : "border-white/20"
                        }`}
                      >
                        {selected ? (
                          <CheckCircleIcon className="h-5 w-5 text-[#173868]" />
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-sm text-[#8e8e8e]">
                {selectedLibraryRuns.length} file
                {selectedLibraryRuns.length === 1 ? "" : "s"} selected
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLibraryPicker(false)}
                  className="inline-flex h-10 items-center rounded-full border border-white/10 px-4 text-sm font-medium text-[#ececec] transition-colors hover:bg-[#2a2a2a]"
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
        defaultFolder={activeFolderLabel === "All folders" ? "Inbox" : activeFolderLabel}
        title="Add files"
        eyebrow="Upload"
        onCreated={handleCreatedRuns}
      />
    </>
  );
}
