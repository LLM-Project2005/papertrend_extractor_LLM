"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
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
  ChevronDownIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PaperIcon,
  PencilSquareIcon,
  PinIcon,
  PlusIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
  TrashIcon,
} from "@/components/ui/Icons";
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
  paperId: number;
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

const MODEL_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4.1-mini", label: "GPT-4.1 mini" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
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

function sortThreads(
  threads: WorkspaceThreadSummary[],
  pinnedIds: string[]
): WorkspaceThreadSummary[] {
  const pinned = new Set(pinnedIds);
  return [...threads].sort((left, right) => {
    const leftPinned = pinned.has(left.id) ? 1 : 0;
    const rightPinned = pinned.has(right.id) ? 1 : 0;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }
    return (right.updated_at ?? "").localeCompare(left.updated_at ?? "");
  });
}

function sessionLabel(session?: DeepResearchSessionRecord | null) {
  if (!session) return null;
  if (session.status === "planned") return "Planned";
  if (session.status === "queued") return "Queued";
  if (session.status === "waiting_on_analysis") return "Waiting on analysis";
  if (session.status === "processing") return "Researching";
  if (session.status === "completed") return "Completed";
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
  if (!folderId || folderId === "all") {
    return "All folders";
  }
  return folders.find((folder) => folder.id === folderId)?.name ?? "Selected folder";
}

function renderLoadingLabel(
  deepResearchEnabled: boolean,
  activeSession?: DeepResearchSessionRecord | null
) {
  if (deepResearchEnabled) {
    if (activeSession?.status === "planned") return "Planning deep research...";
    if (activeSession?.status === "waiting_on_analysis") return "Waiting for folder analysis...";
    return "Running deep research...";
  }
  return "Generating answer...";
}

export default function ChatClient() {
  const { session, user } = useAuth();
  const {
    folders,
    selectedYears,
    selectedTracks,
    searchQuery,
    startAnalysisSession,
    refreshFolders,
  } = useWorkspaceProfile();
  const [chatScopeFolderId, setChatScopeFolderId] = useState<string>("all");
  const [selectedModel, setSelectedModel] = useState("");
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const { allYears } = useDashboardData(
    deepResearchEnabled ? chatScopeFolderId : "all"
  );
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<WorkspaceThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<WorkspaceThreadSummary | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [deepSession, setDeepSession] = useState<DeepResearchSessionRecord | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const canPersist = Boolean(user && session?.access_token);
  const effectiveSelectedYears = selectedYears.length > 0 ? selectedYears : allYears;
  const effectiveSelectedTracks =
    selectedTracks.length > 0 ? selectedTracks : [...TRACK_COLS];
  const requestHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    return headers;
  }, [session?.access_token]);
  const sortedThreads = useMemo(
    () => sortThreads(threads, pinnedThreadIds),
    [pinnedThreadIds, threads]
  );
  const activeFolderLabel = useMemo(
    () => buildFolderLabel(chatScopeFolderId, folders),
    [chatScopeFolderId, folders]
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
        if (Array.isArray(parsed)) {
          setPinnedThreadIds(parsed.filter(Boolean));
        }
      }
      setSelectedModel(window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY) ?? "");
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
    resizeComposer();
  }, [draft, resizeComposer]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deepSession?.status, loading, messages]);

  const resetChat = useCallback(
    (mode: ChatMode = deepResearchEnabled ? "deep_research" : "normal") => {
      setActiveThreadId(null);
      setActiveThread(null);
      setMessages([]);
      setDeepSession(null);
      setError(null);
      setThreadMenuId(null);
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
        const payload = (await response.json()) as ChatThreadDetail & { error?: string };
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

  async function handleNormalSend() {
    const prompt = draft.trim();
    if (!prompt) return;

    setLoading(true);
    setError(null);
    setMenuOpen(false);

    const nextMessages = [...messages, localMessage("user", prompt)];
    if (!canPersist) {
      setMessages(nextMessages);
    }

    try {
      const payload = await sendRequest({
        message: prompt,
        model: selectedModel || undefined,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        selectedYears: effectiveSelectedYears,
        selectedTracks: effectiveSelectedTracks,
        searchQuery,
        folderId: chatScopeFolderId,
        threadId: activeThread?.mode === "normal" ? activeThread.id : undefined,
        chatMode: "normal",
        action: "message",
      });
      setDraft("");
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

    try {
      const payload = await sendRequest({
        message: prompt,
        folderId: chatScopeFolderId,
        threadId: activeThread?.mode === "deep_research" ? activeThread.id : undefined,
        sessionId:
          activeThread?.mode === "deep_research" ? deepSession?.id : undefined,
        chatMode: "deep_research",
        action: "plan",
      });
      setDraft("");
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
      const payload = (await response.json()) as ChatThreadDetail & { error?: string };
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

  const hasContent = messages.length > 0 || Boolean(deepSession);

  return (
    <>
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-[1500px] gap-4">
        <aside className="hidden w-[280px] flex-none rounded-[28px] border border-slate-200 bg-white p-3 dark:border-[#2f2f2f] dark:bg-[#171717] lg:flex lg:flex-col">
          <button
            type="button"
            onClick={() => resetChat("normal")}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#2f2f2f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            <PencilSquareIcon className="h-4 w-4" />
            <span>New chat</span>
          </button>

          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <div className="px-1">
              <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                Your chats
              </p>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {threadsLoading ? (
                <div className="rounded-xl px-3 py-3 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Loading...
                </div>
              ) : null}

              {!threadsLoading && sortedThreads.length === 0 ? (
                <div className="rounded-xl px-3 py-3 text-sm text-slate-500 dark:text-[#8f8f8f]">
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
                        ? "bg-slate-100 dark:bg-[#232323]"
                        : "hover:bg-slate-50 dark:hover:bg-[#1f1f1f]"
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
                          <PinIcon className="h-3.5 w-3.5 flex-none text-slate-400 dark:text-[#8a8a8a]" />
                        ) : null}
                        <span className="truncate text-[13px] font-medium text-slate-800 dark:text-[#e8e8e8]">
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
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 opacity-0 transition-opacity hover:bg-white hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-[#2a2a2a] dark:hover:text-white"
                    >
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </button>

                    {threadMenuId === thread.id ? (
                      <div className="absolute right-2 top-9 z-20 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-[#2f2f2f] dark:bg-[#1d1d1d]">
                        <button
                          type="button"
                          onClick={() => {
                            togglePinnedThread(thread.id);
                            setThreadMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#252525]"
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
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#252525]"
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
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/20"
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

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#171717]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#2f2f2f] sm:px-5">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => resetChat("normal")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
              >
                <PencilSquareIcon className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                Your chats
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeepResearchEnabled((current) => !current)}
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors ${
                  deepResearchEnabled
                    ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
                }`}
              >
                <SparkIcon className="h-4 w-4" />
                <span>Deep research</span>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {deepSession ? (
              <section className="mx-auto mb-6 max-w-4xl rounded-[26px] border border-slate-200 bg-slate-50 p-5 dark:border-[#2f2f2f] dark:bg-[#1d1d1d]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                        <SparkIcon className="h-4 w-4" />
                      </span>
                      {sessionLabel(deepSession) ? (
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:bg-[#252525] dark:text-[#c5c5c5]">
                          {sessionLabel(deepSession)}
                        </span>
                      ) : null}
                      {deepSession.folder_id ? (
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:bg-[#252525] dark:text-[#c5c5c5]">
                          {buildFolderLabel(deepSession.folder_id, folders)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-[#dedede]">
                      {deepSession.plan_summary || deepSession.prompt}
                    </p>
                  </div>
                  {deepSession.status === "planned" ? (
                    <button
                      type="button"
                      onClick={() => void handleContinueResearch()}
                      disabled={loading}
                      className="inline-flex h-10 items-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                      Continue
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  {deepSession.steps?.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#2f2f2f] dark:bg-[#202020]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-[#f3f3f3]">
                            {step.position}. {step.title}
                          </p>
                          {step.description ? (
                            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-[#aeaeae]">
                              {step.description}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-[#777777]">
                          {step.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {!hasContent && !loading ? (
              <div className="flex min-h-[52vh] items-center justify-center">
                <h1 className="text-center text-[2rem] font-semibold tracking-tight text-slate-900 dark:text-[#ececec]">
                  Where should we begin?
                </h1>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <section key={message.id}>
                      {isUser ? (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-[26px] bg-slate-200 px-5 py-3 text-[15px] leading-7 text-slate-900 dark:bg-[#2c2c2c] dark:text-[#f3f3f3]">
                            <div className="whitespace-pre-wrap">{message.content}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {message.kind === "deep_research_report" ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                              Deep research report
                            </span>
                          ) : null}
                          <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-[#e5e5e5]">
                            {message.content}
                          </div>
                          {message.citations.length > 0 ? (
                            <div className="space-y-2">
                              {message.citations.map((citation) => (
                                <Link
                                  key={`${message.id}-${citation.paperId}`}
                                  href={citation.href}
                                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#303030] dark:bg-[#202020] dark:hover:border-[#3b3b3b] dark:hover:bg-[#232323]"
                                >
                                  <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-[#8f8f8f]" />
                                  <span className="min-w-0">
                                    <span className="font-medium text-slate-900 dark:text-[#ececec]">
                                      [Paper {citation.paperId}] {citation.title}
                                    </span>
                                    <span className="ml-2 text-slate-500 dark:text-[#8f8f8f]">
                                      ({citation.year})
                                    </span>
                                    {citation.reason ? (
                                      <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">
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
                    <div className="mt-1 h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-[#3a3a3a] dark:border-t-white" />
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-[#2f2f2f] dark:bg-[#1f1f1f] dark:text-[#b8b8b8]">
                      {renderLoadingLabel(deepResearchEnabled, deepSession)}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {detailLoading ? (
              <div className="mx-auto mt-4 flex w-full max-w-4xl items-center gap-3 text-sm text-slate-500 dark:text-[#8f8f8f]">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-[#3a3a3a] dark:border-t-white" />
                <span>Loading chat...</span>
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>

          {error ? (
            <div className="border-t border-slate-200 px-4 py-3 text-sm text-red-600 dark:border-[#2f2f2f] dark:text-red-300 sm:px-6">
              {error}
            </div>
          ) : null}

          <div className="border-t border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-6">
            <form onSubmit={handleSubmit} className="mx-auto w-full max-w-4xl">
              <div className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] dark:border-[#2f2f2f] dark:bg-[#1a1a1a]">
                <div className="flex items-end gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenuOpen((current) => !current)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:hover:text-white"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </button>

                    {menuOpen ? (
                      <div className="absolute bottom-12 left-0 z-30 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-[#2f2f2f] dark:bg-[#1c1c1c]">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAnalyzeModal(true);
                            setMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#252525]"
                        >
                          <PaperIcon className="h-4 w-4" />
                          <span>Upload files</span>
                        </button>

                        <div className="mt-2 border-t border-slate-200 pt-2 dark:border-[#2f2f2f]">
                          <div className="flex items-center justify-between px-3 pb-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#777777]">
                              Folder scope
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-[#9a9a9a]">
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
                                ? "bg-slate-100 text-slate-900 dark:bg-[#252525] dark:text-white"
                                : "text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#252525]"
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
                                      ? "bg-slate-100 text-slate-900 dark:bg-[#252525] dark:text-white"
                                      : "text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#252525]"
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

                  <div className="min-w-0 flex-1 rounded-[24px] bg-slate-50 px-3 py-2 dark:bg-[#202020]">
                    <textarea
                      ref={composerRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      placeholder="Ask anything"
                      rows={1}
                      className="max-h-[220px] min-h-[24px] w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-[#6f6f6f]"
                    />

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {!deepResearchEnabled ? (
                          <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 dark:border-[#353535] dark:bg-[#171717] dark:text-[#c8c8c8]">
                            <span>Model</span>
                            <select
                              value={selectedModel}
                              onChange={(event) => setSelectedModel(event.target.value)}
                              className="bg-transparent text-xs font-medium outline-none"
                            >
                              {MODEL_OPTIONS.map((option) => (
                                <option key={option.value || "auto"} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        {chatScopeFolderId !== "all" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 dark:border-[#353535] dark:bg-[#171717] dark:text-[#c8c8c8]">
                            <FolderIcon className="h-3.5 w-3.5" />
                            {activeFolderLabel}
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="submit"
                        disabled={
                          (!loading && draft.trim().length === 0) ||
                          (deepResearchEnabled && !canPersist)
                        }
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                          loading
                            ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                            : draft.trim().length > 0
                              ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                              : "bg-slate-200 text-slate-400 dark:bg-[#2f2f2f] dark:text-[#6f6f6f]"
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
              </div>
            </form>
          </div>
        </div>
      </div>

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
