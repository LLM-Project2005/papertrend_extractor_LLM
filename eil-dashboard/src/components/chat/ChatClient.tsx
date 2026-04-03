"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ArrowRightIcon, ChatIcon, CheckCircleIcon, CircleIcon, PaperIcon, PlusIcon, SendIcon, SparkIcon } from "@/components/ui/Icons";
import type { ChatMode, ChatThreadDetail, DeepResearchSessionRecord, WorkspaceMessageRecord, WorkspaceThreadSummary } from "@/types/research";

interface Citation { paperId: number; title: string; year: string; href: string; reason: string }
interface MessageView { id: string; role: "user" | "assistant" | "system"; content: string; citations: Citation[]; kind: WorkspaceMessageRecord["message_kind"]; metadata?: Record<string, unknown> | null }
interface ChatPayload {
  answer?: string; mode?: "grounded" | "fallback"; citations?: Citation[]; error?: string;
  thread?: WorkspaceThreadSummary; messages?: WorkspaceMessageRecord[]; deepResearchSession?: DeepResearchSessionRecord | null;
}

const NORMAL_STARTERS = [
  "Summarize the main research trends in this folder.",
  "Find papers related to translanguaging and multilingual education.",
  "Compare the major track categories in this folder.",
];
const RESEARCH_STARTERS = [
  "Plan a deep comparison of how assessment changes across the papers in this folder.",
  "Map when intelligibility-related concepts emerge and what they co-occur with.",
  "Compare objective verbs and contribution types across this folder.",
];

const mapMessage = (message: WorkspaceMessageRecord): MessageView => ({
  id: message.id,
  role: message.role,
  content: message.content,
  citations: message.citations ?? [],
  kind: message.message_kind,
  metadata: message.metadata ?? null,
});

const localMessage = (role: MessageView["role"], content: string, citations: Citation[] = [], metadata?: Record<string, unknown>): MessageView => ({
  id: `local-${Math.random().toString(36).slice(2, 10)}`,
  role,
  content,
  citations,
  kind: "chat",
  metadata: metadata ?? null,
});

const upsertThread = (threads: WorkspaceThreadSummary[], thread: WorkspaceThreadSummary) =>
  [thread, ...threads.filter((item) => item.id !== thread.id)].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));

const sessionLabel = (session?: DeepResearchSessionRecord | null) =>
  session?.status === "planned" ? "Planned"
  : session?.status === "queued" ? "Queued"
  : session?.status === "waiting_on_analysis" ? "Waiting on analysis"
  : session?.status === "processing" ? "Researching"
  : session?.status === "completed" ? "Completed"
  : session?.status === "failed" ? "Failed"
  : null;

const sessionActive = (session?: DeepResearchSessionRecord | null) =>
  session?.status === "queued" || session?.status === "waiting_on_analysis" || session?.status === "processing";

export default function ChatClient({
  previewMode = false,
  folderId = "all",
  folderLabel = "All folders",
  selectedYears = [],
  selectedTracks = [],
  searchQuery = "",
}: {
  previewMode?: boolean;
  folderId?: string | "all";
  folderLabel?: string;
  selectedYears?: string[];
  selectedTracks?: string[];
  searchQuery?: string;
}) {
  const { session, user } = useAuth();
  const [chatMode, setChatMode] = useState<ChatMode>("normal");
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<WorkspaceThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<WorkspaceThreadSummary | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [deepSession, setDeepSession] = useState<DeepResearchSessionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const canPersist = Boolean(user && session?.access_token);
  const requestHeaders = useMemo(
    (): Record<string, string> =>
      session?.access_token
        ? {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          }
        : { "Content-Type": "application/json" },
    [session?.access_token]
  );
  const starters = chatMode === "deep_research" ? RESEARCH_STARTERS : NORMAL_STARTERS;

  const resetThread = useCallback((mode: ChatMode = "normal") => {
    setActiveThreadId(null); setActiveThread(null); setMessages([]); setDeepSession(null); setError(null); setChatMode(mode);
  }, []);

  const applyPayload = useCallback((payload: ChatPayload) => {
    if (payload.thread) {
      setActiveThread(payload.thread);
      setActiveThreadId(payload.thread.id);
      setChatMode(payload.thread.mode);
      setThreads((current) => upsertThread(current, payload.thread!));
    }
    if (payload.messages) setMessages(payload.messages.map(mapMessage));
    setDeepSession(payload.deepResearchSession ?? null);
  }, []);

  const refreshThreads = useCallback(async (preferredThreadId?: string | null) => {
    if (!canPersist || !session?.access_token) { setThreads([]); return; }
    setThreadsLoading(true);
    try {
      const params = new URLSearchParams({ folderId: folderId || "all" });
      const response = await fetch(`/api/chat/threads?${params.toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json() as { threads?: WorkspaceThreadSummary[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load chat history.");
      const nextThreads = payload.threads ?? [];
      setThreads(nextThreads);
      setActiveThreadId((current) => preferredThreadId ?? (current && nextThreads.some((item) => item.id === current) ? current : nextThreads[0]?.id ?? null));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load chat history.");
    } finally {
      setThreadsLoading(false);
    }
  }, [canPersist, folderId, session?.access_token]);

  const loadThreadDetail = useCallback(async (threadId: string) => {
    if (!canPersist || !session?.access_token) return;
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/chat/threads/${threadId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json() as ChatThreadDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load thread.");
      setActiveThread(payload.thread);
      setChatMode(payload.thread.mode);
      setMessages((payload.messages ?? []).map(mapMessage));
      setDeepSession(payload.deepResearchSession ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load thread.");
    } finally {
      setDetailLoading(false);
    }
  }, [canPersist, session?.access_token]);

  useEffect(() => { scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" }); }, [deepSession?.status, loading, messages]);
  useEffect(() => { if (!canPersist) { setThreads([]); setActiveThreadId(null); setActiveThread(null); setDeepSession(null); return; } void refreshThreads(null); }, [canPersist, folderId, refreshThreads]);
  useEffect(() => { if (activeThreadId && canPersist) void loadThreadDetail(activeThreadId); }, [activeThreadId, canPersist, loadThreadDetail]);
  useEffect(() => {
    if (!canPersist || !activeThreadId || !sessionActive(deepSession)) return;
    const timer = window.setInterval(() => { void loadThreadDetail(activeThreadId); }, 5000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, canPersist, deepSession, loadThreadDetail]);

  async function sendRequest(body: Record<string, unknown>) {
    const response = await fetch("/api/chat", { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
    const payload = await response.json() as ChatPayload;
    if (!response.ok) throw new Error(payload.error ?? "Chat request failed.");
    return payload;
  }

  async function handleNormalSend() {
    const prompt = draft.trim();
    if (!prompt) return;
    setLoading(true); setError(null);
    const nextMessages = [...messages, localMessage("user", prompt)];
    if (!canPersist) setMessages(nextMessages);
    try {
      const payload = await sendRequest({
        message: prompt,
        messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        selectedYears, selectedTracks, searchQuery, folderId,
        threadId: activeThread?.mode === "normal" ? activeThread.id : undefined,
        chatMode: "normal", action: "message",
      });
      setDraft("");
      if (payload.thread && payload.messages) applyPayload(payload);
      else setMessages([...nextMessages, localMessage("assistant", payload.answer ?? "No answer returned.", payload.citations ?? [], { mode: payload.mode ?? "fallback" })]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Chat request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePlanResearch() {
    const prompt = draft.trim();
    if (!prompt) return;
    if (!canPersist) { setError("Sign in to use deep research mode."); return; }
    setLoading(true); setError(null);
    try {
      const payload = await sendRequest({
        message: prompt,
        folderId,
        threadId: activeThread?.mode === "deep_research" ? activeThread.id : undefined,
        sessionId: activeThread?.mode === "deep_research" ? deepSession?.id : undefined,
        chatMode: "deep_research", action: "plan",
      });
      applyPayload(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to build research plan.");
    } finally {
      setLoading(false);
    }
  }

  async function handleContinueResearch() {
    if (!canPersist || !activeThread || !deepSession) return;
    setLoading(true); setError(null);
    try {
      const payload = await sendRequest({
        folderId, threadId: activeThread.id, sessionId: deepSession.id,
        chatMode: "deep_research", action: "continue",
      });
      applyPayload(payload);
      await refreshThreads(activeThread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to continue deep research.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chatMode === "deep_research") { await handlePlanResearch(); return; }
    await handleNormalSend();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-[1500px] gap-5">
      <aside className="hidden w-[300px] flex-none rounded-[28px] border border-slate-200 bg-white p-4 dark:border-[#2f2f2f] dark:bg-[#171717] xl:block">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">Folder scope</p><h2 className="mt-1 text-lg font-semibold text-slate-950 dark:text-[#ececec]">{folderLabel}</h2></div>
          <button type="button" onClick={() => resetThread(chatMode)} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#343434] dark:bg-[#202020] dark:text-[#cfcfcf] dark:hover:border-[#474747] dark:hover:text-white"><PlusIcon className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2f2f2f] dark:bg-[#202020]">
          <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">Conversation history</p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">{canPersist ? "Threads are saved per folder so you can reopen them later." : "Sign in to save history and deep research sessions."}</p>
        </div>
        <div className="mt-4 space-y-2 overflow-y-auto pr-1">
          {threadsLoading ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500 dark:border-[#2f2f2f] dark:text-[#8f8f8f]">Loading threads...</div> : null}
          {!threadsLoading && threads.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500 dark:border-[#2f2f2f] dark:text-[#8f8f8f]">{canPersist ? "No saved threads in this folder yet." : "History unlocks after sign-in."}</div> : null}
          {threads.map((thread) => {
            const active = thread.id === activeThreadId;
            return <button key={thread.id} type="button" onClick={() => setActiveThreadId(thread.id)} className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${active ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900" : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#2f2f2f] dark:bg-[#202020] dark:text-[#ececec] dark:hover:border-[#404040]"}`}><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${thread.mode === "deep_research" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-[#242424] dark:text-[#bfbfbf]"}`}>{thread.mode === "deep_research" ? "Deep research" : "Normal"}</span><span className={`text-[11px] ${active ? "text-white/80 dark:text-slate-700" : "text-slate-400 dark:text-[#777777]"}`}>{thread.updated_at ? new Date(thread.updated_at).toLocaleString() : "Just now"}</span></div><p className="mt-3 line-clamp-2 text-sm font-medium">{thread.title}</p>{thread.summary ? <p className={`mt-2 line-clamp-2 text-xs leading-5 ${active ? "text-white/80 dark:text-slate-700" : "text-slate-500 dark:text-[#9a9a9a]"}`}>{thread.summary}</p> : null}</button>;
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col rounded-[30px] border border-slate-200 bg-white px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717] sm:px-5 sm:py-5">
        <div className="border-b border-slate-200 pb-4 dark:border-[#2f2f2f]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">Workspace chat</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-[#ececec]">Folder-scoped research assistant</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-[#b8b8b8]">The assistant reads from <span className="font-medium">{folderLabel}</span> first, keeps history with the folder, and can switch into a staged deep research workflow when needed.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">Scope: {folderLabel}</span>
              <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#212121]">
                <button type="button" onClick={() => setChatMode("normal")} className={`px-3 py-2 text-sm font-medium transition-colors ${chatMode === "normal" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-50 dark:text-[#cfcfcf] dark:hover:bg-[#262626]"}`}>Normal</button>
                <button type="button" onClick={() => setChatMode("deep_research")} className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${chatMode === "deep_research" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-50 dark:text-[#cfcfcf] dark:hover:bg-[#262626]"}`}><SparkIcon className="h-4 w-4" /><span>Deep Research</span></button>
              </div>
            </div>
          </div>
          {previewMode ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">Preview mode is active, so answers are temporarily based on the preview dataset until live analysis is available in this folder scope.</div> : null}
          {chatMode === "deep_research" && !canPersist ? <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-[#303030] dark:bg-[#202020] dark:text-[#d0d0d0]">Sign in to use deep research mode. Plans, step logs, and final reports are saved inside the selected folder history.</div> : null}
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          {deepSession ? (
            <section className="mb-5 rounded-[28px] border border-slate-200 bg-white px-5 py-5 dark:border-[#2f2f2f] dark:bg-[#1b1b1b]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900"><SparkIcon className="h-4 w-4" /></span>
                    {sessionLabel(deepSession) ? <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#242424] dark:text-[#bfbfbf]">{sessionLabel(deepSession)}</span> : null}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-[#f2f2f2]">Deep research plan</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-[#b8b8b8]">{deepSession.plan_summary || deepSession.prompt}</p>
                </div>
                {deepSession.status === "planned" ? <button type="button" onClick={() => void handleContinueResearch()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"><ArrowRightIcon className="h-4 w-4" /><span>{loading ? "Starting..." : "Continue"}</span></button> : null}
              </div>
              {deepSession.requires_analysis ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">This run needs folder analysis first. After you continue, the system will queue the missing analysis and resume the research automatically.</div> : null}
              {deepSession.last_error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{deepSession.last_error}</div> : null}
              <div className="mt-5 space-y-3">
                {deepSession.steps?.map((step) => {
                  const done = step.status === "completed";
                  const active = step.status === "processing" || step.status === "waiting";
                  return <article key={step.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#202020]"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2">{done ? <CheckCircleIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> : <CircleIcon className={`h-4 w-4 ${active ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-[#666666]"}`} />}<p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{step.position}. {step.title}</p></div>{step.description ? <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-[#b8b8b8]">{step.description}</p> : null}</div><span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-[#8f8f8f]">{step.status}</span></div></article>;
                })}
              </div>
              {deepSession.status === "planned" ? <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">You can revise the request in the composer below, then click Plan research again to update the steps before continuing.</p> : null}
            </section>
          ) : null}

          {messages.length === 0 ? (
            <section className="mx-auto flex min-h-[40vh] max-w-3xl flex-col justify-center py-8">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-slate-100 text-slate-600 dark:bg-[#202020] dark:text-[#d0d0d0]">{chatMode === "deep_research" ? <SparkIcon className="h-7 w-7" /> : <ChatIcon className="h-7 w-7" />}</div>
              <h2 className="mt-6 text-center text-[2rem] font-semibold tracking-tight text-slate-950 dark:text-[#ececec]">{chatMode === "deep_research" ? "Plan a deeper corpus investigation" : "How can I help with this folder?"}</h2>
              <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-slate-500 dark:text-[#8f8f8f]">{chatMode === "deep_research" ? "Plan a step-by-step corpus investigation, review the proposed steps, then continue when you're ready." : "Ask about papers, topics, tracks, keywords, or trends. Answers stay grounded in the selected folder first."}</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">{starters.map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#303030] dark:bg-[#1f1f1f] dark:text-[#d1d1d1] dark:hover:border-[#3b3b3b] dark:hover:bg-[#232323]">{prompt}</button>)}</div>
            </section>
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-2">
              {messages.map((message) => {
                const tone = message.kind === "deep_research_plan" ? "plan" : message.kind === "deep_research_report" ? "report" : message.metadata?.mode === "fallback" ? "fallback" : "default";
                return <section key={message.id}>{message.role === "user" ? <div className="flex justify-end"><div className="max-w-[82%] rounded-[26px] bg-slate-200 px-5 py-3 text-[15px] leading-7 text-slate-900 dark:bg-[#2f2f2f] dark:text-[#f5f5f5]"><div className="whitespace-pre-wrap">{message.content}</div></div></div> : <div className="space-y-4">{tone === "plan" ? <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-[#3b3b3b] dark:bg-[#202020] dark:text-[#d7d7d7]">Research plan saved</div> : null}{tone === "report" ? <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">Deep research report</div> : null}{tone === "fallback" ? <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">Broader guidance</div> : null}<div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-[#e5e5e5]">{message.content}</div>{message.citations.length > 0 ? <div className="space-y-2">{message.citations.map((citation) => <Link key={`${message.id}-${citation.paperId}`} href={citation.href} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#303030] dark:bg-[#202020] dark:hover:border-[#3b3b3b] dark:hover:bg-[#232323]"><PaperIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-[#8f8f8f]" /><span className="min-w-0"><span className="font-medium text-slate-900 dark:text-[#ececec]">[Paper {citation.paperId}] {citation.title}</span><span className="ml-2 text-slate-500 dark:text-[#8f8f8f]">({citation.year})</span>{citation.reason ? <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">{citation.reason}</span> : null}</span></Link>)}</div> : null}</div>}</section>;
              })}
            </div>
          )}
          <div ref={scrollAnchorRef} />
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div> : null}

        <form onSubmit={handleSubmit} className="mt-5">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#202020]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">{chatMode === "deep_research" ? "Deep research request" : "Ask about this folder"}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">{chatMode === "deep_research" ? "First we plan the steps. After you review the plan, click Continue to run it." : "Normal chat answers from the selected folder first and saves the conversation here."}</p></div>
              <button type="button" onClick={() => resetThread(chatMode)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#343434] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:hover:text-white"><PlusIcon className="h-4 w-4" /><span>New thread</span></button>
            </div>
            <div className="mt-4"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={chatMode === "deep_research" ? "Ask for a staged research plan, for example: Compare how assessment changes across the papers in this folder." : "Ask about papers, concepts, methods, tracks, or trends in this folder."} rows={5} className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#3a3a3a] dark:bg-[#171717] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10" /></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-[#8f8f8f]"><span className="rounded-full bg-white px-3 py-1.5 dark:bg-[#171717]">{selectedYears.length} selected years</span><span className="rounded-full bg-white px-3 py-1.5 dark:bg-[#171717]">{selectedTracks.length} selected tracks</span></div>
              <button type="submit" disabled={loading || detailLoading || draft.trim().length === 0 || (chatMode === "deep_research" && !canPersist)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100">{chatMode === "deep_research" ? <SparkIcon className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}<span>{loading ? chatMode === "deep_research" ? "Planning..." : "Sending..." : chatMode === "deep_research" ? "Plan research" : "Send"}</span></button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
