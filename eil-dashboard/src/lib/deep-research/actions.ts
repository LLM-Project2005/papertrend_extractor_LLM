/*
 * What the chat route does for deep research v2 (docs/31): plan, start (or
 * retry), cancel, and pick up a run whose worker went quiet.
 *
 * Planning costs one small model call, counted toward the daily token budget;
 * starting a run costs one deep research unit. A retry after a failure or a
 * cancel resumes the same run and costs nothing more.
 */
import { getChatRepository } from "@/lib/chat-repository";
import { loadRepositoryContext } from "@/lib/repository-chat";
import { normalizeKnowledgeScope, type KnowledgeScope } from "@/lib/knowledge-scope";
import { assertAndRecordAiUsage } from "@/lib/security-guards";
import type { ChatThreadDetail, DeepResearchSessionRecord } from "@/types/research";
import { callTool } from "@/lib/deep-research/model";
import { dedupeStudies, fallbackPlan, mergeSelection, parsePlan, planMessages, planSummary, planTool, rankStudies, studyCards, studyOf } from "@/lib/deep-research/plan";
import { runResearchSession } from "@/lib/deep-research/run";
import {
  cancelSession,
  failSession,
  isStale,
  isV2Session,
  latestPlannedSession,
  loadSession,
  markRequeued,
  savePlan,
  startSession,
} from "@/lib/deep-research/store";
import { enqueueResearchRun, researchQueue } from "@/lib/deep-research/tasks";
import { isCurrentEngine, LIMITS } from "@/lib/deep-research/types";

export interface ResearchRequest {
  message?: string;
  threadId?: string;
  sessionId?: string;
  projectId?: string;
  folderId?: string | null;
  selectedRunIds?: string[];
  knowledgeScope?: KnowledgeScope;
  attachments?: unknown[];
}

function titleFrom(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line || "Deep research";
}

async function detailOf(ownerUserId: string, threadId: string): Promise<ChatThreadDetail> {
  return getChatRepository().getThreadDetail(ownerUserId, threadId);
}

/** Plans the question as a new run, or re-plans the thread's run not yet started. */
export async function planResearch(body: ResearchRequest, ownerUserId: string): Promise<ChatThreadDetail> {
  const prompt = String(body.message ?? "").trim();
  if (!prompt) throw new Error("Message is required.");
  const knowledgeScope = normalizeKnowledgeScope({
    knowledgeScope: body.knowledgeScope,
    projectId: body.projectId,
    folderId: body.folderId ?? undefined,
    selectedRunIds: body.selectedRunIds,
  });
  const repository = getChatRepository();
  const thread = body.threadId
    ? (await repository.getThreadDetail(ownerUserId, body.threadId)).thread
    : await repository.createThread({ ownerUserId, mode: "deep_research", title: titleFrom(prompt), summary: "Planning deep research" });
  const earlier = body.threadId ? (await repository.getThreadDetail(ownerUserId, thread.id)).messages : [];
  await repository.appendMessage({
    threadId: thread.id,
    ownerUserId,
    folderId: knowledgeScope.folderId ?? null,
    role: "user",
    content: prompt,
    messageKind: "chat",
    metadata: { chatMode: "deep_research", attachments: body.attachments ?? [], selectedRunIds: knowledgeScope.runIds ?? [], knowledgeScope },
  });

  const context = await loadRepositoryContext({
    ownerUserId,
    projectId: knowledgeScope.projectId ?? null,
    folderId: knowledgeScope.folderId ?? null,
    selectedRunIds: knowledgeScope.runIds ?? [],
    knowledgeScope,
    prompt,
  });
  if (context.papers.length === 0) {
    await repository.appendMessage({
      threadId: thread.id,
      ownerUserId,
      folderId: knowledgeScope.folderId ?? null,
      role: "assistant",
      content: `No completed, analysed papers were found in ${context.scopeLabel}, so there is nothing to research yet. Upload or finish analysing papers, then ask again.`,
      messageKind: "status",
      metadata: { chatMode: "deep_research" },
    });
    return detailOf(ownerUserId, thread.id);
  }

  const history = earlier
    .filter((message) => (message.role === "user" || message.role === "assistant") && (message.message_kind === "chat" || message.message_kind === "deep_research_report"))
    .slice(-4)
    .map((message) => ({ role: message.role as "user" | "assistant", content: String(message.content ?? "") }));
  // One card per study (a duplicate upload is one study); the planner chooses what to read.
  const studies = dedupeStudies(context.papers.map(studyOf));
  const cards = studyCards(studies, prompt);
  const raw = await callTool(
    planMessages({
      question: prompt,
      scopeLabel: context.scopeLabel,
      cards,
      totalStudies: studies.length,
      webAvailable: true,
      today: new Date().toISOString().slice(0, 10),
      history,
    }),
    planTool(),
    "DEEP_RESEARCH_PLAN",
    { maxTokens: 6_000, timeoutMs: 60_000, reasoningEffort: "low" }
  );
  const parsed = parsePlan(raw, { question: prompt, cards, webAvailable: true });
  // The repository's ranking adds what a card may have hidden (plan.ts).
  const ranked = rankStudies(studies, [prompt, ...(parsed?.searchTerms ?? [])], LIMITS.rankingTop);
  const plan = parsed ? { ...parsed, papers: mergeSelection(parsed.papers, ranked, studies) } : fallbackPlan(prompt, ranked, studies);
  const planned = await latestPlannedSession(ownerUserId, thread.id);
  await savePlan({
    ownerUserId,
    threadId: thread.id,
    replaceSessionId: planned?.id ?? null,
    prompt,
    plan,
    summary: planSummary(plan),
    scope: {
      kind: knowledgeScope.kind,
      projectId: knowledgeScope.projectId ?? null,
      folderId: knowledgeScope.folderId ?? null,
      runIds: knowledgeScope.runIds ?? [],
    },
    model: null,
  });
  return detailOf(ownerUserId, thread.id);
}

/** Queues the run; off Cloud Run (no queue), runs it in this request instead. */
async function dispatch(ownerUserId: string, sessionId: string, origin: string): Promise<void> {
  const queued = await enqueueResearchRun(sessionId, ownerUserId, origin);
  if (queued) return;
  if (!researchQueue()) {
    await runResearchSession({ ownerUserId, sessionId, retryCount: 2 });
    return;
  }
  await failSession(ownerUserId, sessionId, "The research could not be started just now. Retry in a moment.");
}

/** Starts a planned run (one deep research unit), or resumes a failed or canceled one. */
export async function startResearch(body: ResearchRequest, ownerUserId: string, origin: string): Promise<ChatThreadDetail | null> {
  if (!body.threadId || !body.sessionId) throw new Error("threadId and sessionId are required to start deep research.");
  const session = await loadSession(ownerUserId, body.sessionId);
  // Planned by the old worker, or by deep research v2's passage search: planned again instead.
  if (!session || !isCurrentEngine(session)) return null;
  // One unit per run: charged on its first start, including a plan canceled
  // before it ever ran; a retry of a run that already did work is free.
  const neverRan = (session.steps ?? []).every((step) => !(step.output_payload as { engine?: string } | undefined)?.engine);
  if (session.status === "planned" || (session.status === "canceled" && neverRan)) {
    await assertAndRecordAiUsage(ownerUserId, "deep_research", { action: "start", sessionId: session.id });
  }
  const started = await startSession(ownerUserId, session.id);
  if (started.started) await dispatch(ownerUserId, session.id, origin);
  return detailOf(ownerUserId, body.threadId);
}

export async function cancelResearch(body: ResearchRequest, ownerUserId: string): Promise<ChatThreadDetail> {
  if (!body.threadId || !body.sessionId) throw new Error("threadId and sessionId are required to cancel deep research.");
  await cancelSession(ownerUserId, body.sessionId);
  return detailOf(ownerUserId, body.threadId);
}

/** Opening a thread whose run has gone quiet queues it again; the lease keeps it to one worker. */
export async function resumeIfStale(ownerUserId: string, session: DeepResearchSessionRecord | null, origin: string): Promise<boolean> {
  if (!session || !isV2Session(session) || !isStale(session)) return false;
  // Only the poll that marks it re-queues it; the others see it fresh again.
  if (!(await markRequeued(ownerUserId, session.id))) return false;
  return enqueueResearchRun(session.id, ownerUserId, origin);
}
