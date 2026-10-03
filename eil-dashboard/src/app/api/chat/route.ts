import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { buildThreadTitle } from "@/lib/chat-store";
import { getChatRepository } from "@/lib/chat-repository";
import { runRepositoryChat } from "@/lib/repository-chat";
import { addWebContext, webStepApplies } from "@/lib/repository-chat-web";
import { cancelResearch, planResearch, startResearch } from "@/lib/deep-research/actions";
import { chatCorsPreflight, withChatCors } from "@/lib/chat-cors";
import { runWithCancellation } from "@/lib/chat-cancellation";
import { isValidRequestId, registerCancellable } from "@/lib/chat-cancel-registry";
import { runWithModelLatency, summarizeModelLatency } from "@/lib/model-latency";
import {
  encodeErrorFrame,
  encodeProgressFrame,
  encodeResultFrame,
  runWithChatProgress,
  type ChatProgressEvent,
} from "@/lib/chat-progress";
import {
  knowledgeScopeLabel,
  normalizeKnowledgeScope,
  type KnowledgeScope,
  type KnowledgeScopeSnapshot,
} from "@/lib/knowledge-scope";
import { getDatabaseProvider } from "@/lib/server-env";
import { GuardError, assertAiTokenBudget, persistAiTokenUsage } from "@/lib/security-guards";
import { withAiTokenUsageTracking, type AiTokenUsageTotals } from "@/lib/ai-token-usage";
import { spendUsd, summarizeSpend } from "@/lib/answer-cost";
import { adviseOnFailure } from "@/lib/model-failure";
import { ModelCallError } from "@/lib/openai";
import { getPublicRequestOrigin } from "@/lib/public-request-origin";
import type { ChatThreadDetail, WorkspaceMessageRecord } from "@/types/research";

/*
 * The chat endpoint: every answer runs through the repository chat
 * (src/lib/repository-chat.ts), and deep research through v2
 * (src/lib/deep-research/, docs/31). The routes it replaced - a chart agent, a
 * general model answer with its own web search, and deep research on a Python
 * worker - could no longer be reached in production and were removed
 * (docs/32, long-term health).
 */

interface Citation {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason: string;
  sourceType?: "paper" | "web";
}

type ChatToolMode = "auto" | "web_search" | "chart" | "none";
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

interface ChatChartPayload {
  chartType: Exclude<ChartType, "auto">;
  title: string;
  scopeLabel: string;
  metric: ChartMetric;
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

interface ChatToolResult {
  type: "web_search" | "chart";
  status: "succeeded" | "failed" | "skipped";
  data?: unknown;
  citations?: Citation[];
  error?: string;
}

interface ChatRequestBody {
  message?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  attachments?: Array<{
    name: string;
    type?: string;
    size?: number;
    url?: string;
    previewUrl?: string;
    dataUrl?: string;
    runId?: string;
    status?: string;
    sourceLabel?: string;
    extension?: string;
  }>;
  selectedRunIds?: string[];
  threadId?: string;
  editMessageId?: string;
  folderId?: string | "all";
  projectId?: string;
  knowledgeScope?: KnowledgeScope;
  toolMode?: ChatToolMode;
  /** Asks for a chart; the repository chat decides which. */
  chartRequest?: Record<string, unknown>;
  webSearchEnabled?: boolean;
  chatMode?: "normal" | "deep_research";
  action?: "message" | "plan" | "continue" | "cancel";
  sessionId?: string;
}

const ChatRequestBodySchema = z
  .object({
    message: z.string().max(12_000).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(12_000),
        })
      )
      .max(24)
      .optional(),
    model: z.string().max(120).optional(),
    attachments: z
      .array(
        z.object({
          name: z.string().max(240),
          type: z.string().max(120).optional(),
          size: z.preprocess(
            (value) => typeof value === "string" && value.trim() ? Number(value) : value,
            z.number().nonnegative().max(100 * 1024 * 1024)
          ).optional(),
          url: z.string().max(5_000).optional(),
          previewUrl: z.string().max(5_000).optional(),
          dataUrl: z.string().max(2_000_000).optional(),
          runId: z.string().max(80).optional(),
          status: z.string().max(80).optional(),
          sourceLabel: z.string().max(120).optional(),
          extension: z.string().max(20).optional(),
        })
      )
      .max(10)
      .optional(),
    // Sent by older pages and bounded here; nothing reads them any more.
    generationParameters: z
      .object({
        temperature: z.number().optional(),
        topP: z.number().optional(),
        topK: z.number().optional(),
        maxTokens: z.number().optional(),
        frequencyPenalty: z.number().optional(),
        presencePenalty: z.number().optional(),
      })
      .optional(),
    selectedYears: z.array(z.string().max(20)).max(80).optional(),
    selectedTracks: z.array(z.string().max(80)).max(20).optional(),
    searchQuery: z.string().max(1_000).optional(),
    queryLanguage: z.string().max(20).optional(),
    selectedRunIds: z.array(z.string().max(80)).max(50).optional(),
    threadId: z.string().max(80).optional(),
    editMessageId: z.string().max(80).optional(),
    folderId: z.string().max(80).optional(),
    projectId: z.string().max(80).optional(),
    knowledgeScope: z.object({
      kind: z.enum(["all_projects", "project", "folder", "selected_papers"]),
      projectId: z.string().max(80).optional(),
      folderId: z.string().max(80).optional(),
      runIds: z.array(z.string().max(80)).max(50).optional(),
    }).optional(),
    toolMode: z.enum(["auto", "web_search", "chart", "none"]).optional(),
    chartRequest: z.record(z.string(), z.unknown()).optional(),
    webSearchEnabled: z.boolean().optional(),
    researchSourcePolicy: z.record(z.string(), z.unknown()).optional(),
    chatMode: z.enum(["normal", "deep_research"]).optional(),
    action: z.enum(["message", "plan", "continue", "cancel"]).optional(),
    sessionId: z.string().max(80).optional(),
  })
  .passthrough();

function parseChatRequestBody(value: unknown): ChatRequestBody {
  const parsed = ChatRequestBodySchema.safeParse(value);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "request")))];
    console.warn("Chat request validation failed.", {
      fields,
      issues: parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join(".") })),
    });
    const oversized = parsed.error.issues.some((issue) => issue.code === "too_big");
    throw new GuardError(
      oversized
        ? "This chat request exceeded its safe context limit. The page may be out of date; refresh it and try again."
        : `Chat request contains invalid ${fields.join(", ") || "data"}. Refresh the page and try again.`,
      400
    );
  }
  return parsed.data as ChatRequestBody;
}

const DEFAULT_CHAT_MODEL = "openai/gpt-5.6-luna-20260709";
const TOOL_CAPABLE_CHAT_MODELS = [
  "openai/gpt-5.6-luna-20260709",
  "google/gemini-3.7-flash",
] as const;

function resolveChatModel(model?: string | null) {
  const normalized = String(model ?? "").trim();
  return TOOL_CAPABLE_CHAT_MODELS.includes(
    normalized as (typeof TOOL_CAPABLE_CHAT_MODELS)[number]
  )
    ? normalized
    : DEFAULT_CHAT_MODEL;
}

async function normalChat(request: Request, body: ChatRequestBody, ownerUserId: string): Promise<NextResponse> {
  const currentMessage =
    body.message ??
    [...(body.messages ?? [])]
      .reverse()
      .find((message) => message.role === "user")?.content;

  if (!currentMessage?.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const requestId = randomUUID();
  const knowledgeScope = normalizeKnowledgeScope({
    knowledgeScope: body.knowledgeScope,
    projectId: body.projectId,
    folderId: body.folderId,
    selectedRunIds: body.selectedRunIds,
  });
  const preliminaryScopeSnapshot: KnowledgeScopeSnapshot = {
    kind: knowledgeScope.kind,
    label: knowledgeScopeLabel(knowledgeScope),
    projectId: knowledgeScope.projectId ?? null,
    projectName: null,
    folderId: knowledgeScope.folderId ?? null,
    folderName: null,
    selectedRunCount: knowledgeScope.runIds?.length ?? 0,
    eligiblePaperCount: 0,
  };

  const chatRepository = getChatRepository();
  let thread: ChatThreadDetail["thread"] | null = null;
  let existingThreadDetail: ChatThreadDetail | null = null;
  let persistedUserMessage: WorkspaceMessageRecord | null = null;
  {
    if (body.threadId) {
      existingThreadDetail = await chatRepository.getThreadDetail(ownerUserId, body.threadId);
      thread = existingThreadDetail.thread;
    } else {
      thread = await chatRepository.createThread({
          ownerUserId,
          mode: "normal",
          title: buildThreadTitle(currentMessage),
          summary: currentMessage.slice(0, 180),
        });
    }

    const editTarget =
      body.editMessageId && existingThreadDetail
        ? existingThreadDetail.messages.find(
            (message) =>
              message.id === body.editMessageId && message.role === "user"
          )
        : null;

    if (editTarget) {
      if (!editTarget.created_at) {
        throw new Error("Chat message timestamp is missing.");
      }
      await chatRepository.editUserMessage({
        ownerUserId,
        threadId: thread.id,
        messageId: editTarget.id,
        content: currentMessage,
        metadata: {
          ...(editTarget.metadata && typeof editTarget.metadata === "object"
            ? (editTarget.metadata as Record<string, unknown>)
            : {}),
          attachments: body.attachments ?? [],
          selectedRunIds: body.selectedRunIds ?? [],
          knowledgeScope,
          scopeSnapshot: preliminaryScopeSnapshot,
          editedAt: new Date().toISOString(),
        },
        createdAt: editTarget.created_at,
      });
      persistedUserMessage = { ...editTarget, content: currentMessage };
    } else {
      persistedUserMessage = await chatRepository.appendMessage({
        threadId: thread.id,
        ownerUserId,
        folderId: knowledgeScope.folderId,
        role: "user",
        content: currentMessage,
        messageKind: "chat",
        metadata: {
          attachments: body.attachments ?? [],
          selectedRunIds: body.selectedRunIds ?? [],
          knowledgeScope,
          scopeSnapshot: preliminaryScopeSnapshot,
          requestId,
        },
      });
    }
  }

  const requestedToolMode: ChatToolMode = body.toolMode ?? "auto";
  const chartRequested =
    requestedToolMode === "chart" ||
    Boolean(body.chartRequest);
  const selectedModel = resolveChatModel(body.model);

  if (!thread) throw new Error("The conversation could not be opened.");
  const startedAt = Date.now();
  try {
    const repositoryResult = await runRepositoryChat({
      ownerUserId,
      threadId: thread.id,
      projectId: knowledgeScope.projectId,
      folderId: knowledgeScope.folderId,
      selectedRunIds: knowledgeScope.runIds,
      knowledgeScope,
      allowWeb: requestedToolMode === "web_search" || Boolean(body.webSearchEnabled),
      prompt: currentMessage,
      model: selectedModel,
      forceChart: chartRequested,
      history: (body.messages ?? []).slice(-12),
      jobCallbackBaseUrl: getPublicRequestOrigin(request),
      sourceMessageId: persistedUserMessage?.id ?? null,
    });
    if (repositoryResult.handled) {
      if (repositoryResult.jobId) {
        if (persistedUserMessage) {
          await chatRepository.updateMessageMetadata(ownerUserId, thread.id, persistedUserMessage.id, {
            ...(persistedUserMessage.metadata ?? {}),
            attachments: body.attachments ?? [],
            selectedRunIds: knowledgeScope.runIds ?? [],
            knowledgeScope,
            scopeSnapshot: repositoryResult.scopeSnapshot,
            requestId,
            repositoryJobId: repositoryResult.jobId,
          });
        }
        const detail = await chatRepository.getThreadDetail(ownerUserId, thread.id);
        return NextResponse.json({
          mode: "analysis_queued",
          groundingMode: "repository_processing",
          scopeSnapshot: repositoryResult.scopeSnapshot,
          requestId,
          answer: repositoryResult.answer,
          citations: [],
          toolResults: [],
          charts: [],
          execution: repositoryResult.execution ?? null,
          coverage: repositoryResult.coverage ?? null,
          limitations: repositoryResult.limitations ?? [],
          jobId: repositoryResult.jobId,
          thread: detail.thread,
          messages: detail.messages,
          deepResearchSession: detail.deepResearchSession,
        }, { status: 202 });
      }
      let repositoryAnswer = repositoryResult.answer;
      const repositoryCharts = repositoryResult.charts as ChatChartPayload[];
      // A copy: the result may be a cached answer's, which must not gain web sources.
      const repositoryCitations = [...(repositoryResult.citations as Citation[])];
      const repositoryLimitations = [...(repositoryResult.limitations ?? [])];
      const toolResults: ChatToolResult[] = repositoryCharts.length > 0
        ? [{ type: "chart", status: "succeeded", data: { charts: repositoryCharts } }]
        : [];
      const webSearchRequested =
        (requestedToolMode === "web_search" || Boolean(body.webSearchEnabled)) &&
        webStepApplies(repositoryResult.execution?.operation);
      if (webSearchRequested) {
        const web = await addWebContext({
          ownerUserId,
          question: currentMessage,
          searchQuery: repositoryResult.execution?.refinedQuestion,
          answer: repositoryAnswer,
          answerLanguage: repositoryResult.execution?.answerLanguage,
          model: selectedModel,
        });
        repositoryAnswer = web.answer;
        repositoryCitations.push(...(web.citations as Citation[]));
        if (web.note) repositoryLimitations.push(web.note);
        toolResults.push({
          type: "web_search",
          status: web.status,
          citations: web.citations as Citation[],
          ...(web.status === "failed" ? { error: web.note } : {}),
        });
      }
      if (persistedUserMessage) {
        await chatRepository.updateMessageMetadata(ownerUserId, thread.id, persistedUserMessage.id, {
          ...(persistedUserMessage.metadata ?? {}),
          attachments: body.attachments ?? [], selectedRunIds: knowledgeScope.runIds ?? [], knowledgeScope,
          scopeSnapshot: repositoryResult.scopeSnapshot, requestId,
        });
      }
      console.info("knowledge_chat_route", {
        requestId,
        stage: "completed",
        latencyMs: Date.now() - startedAt,
        ownerUserId,
        scopeKind: repositoryResult.scopeSnapshot.kind,
        projectId: repositoryResult.scopeSnapshot.projectId,
        folderId: repositoryResult.scopeSnapshot.folderId,
        eligiblePaperCount: repositoryResult.scopeSnapshot.eligiblePaperCount,
        operation: repositoryResult.execution?.operation ?? repositoryResult.plan.intent,
        retrievalRounds: repositoryResult.diagnostics.retrievalRounds ?? 0,
        evidenceCount: repositoryResult.diagnostics.selectedEvidenceCount ?? 0,
        groundingMode: webSearchRequested ? "repository_web" : repositoryResult.execution?.operation === "converse" ? "general" : "repository",
      });
      const metadata = {
        mode: "grounded",
        groundingMode: webSearchRequested && repositoryCitations.some((citation) => citation.sourceType === "web") ? "repository_web" : repositoryResult.execution?.operation === "converse" ? "general" : "repository",
        scopeSnapshot: repositoryResult.scopeSnapshot,
        requestId,
        model: selectedModel,
        toolResults,
        chart: repositoryCharts[0] ?? null,
        charts: repositoryCharts,
        repositoryPlan: repositoryResult.plan,
        repositoryExecution: repositoryResult.execution ?? null,
        repositoryCoverage: repositoryResult.coverage ?? null,
        repositoryLimitations,
        repositoryDiagnostics: repositoryResult.diagnostics,
      };

      await chatRepository.appendMessage({
        threadId: thread.id,
        ownerUserId,
        folderId: knowledgeScope.folderId,
        role: "assistant",
        content: repositoryAnswer,
        messageKind: "chat",
        citations: repositoryCitations,
        metadata,
      });
      await chatRepository.updateThread(ownerUserId, thread.id, {
        summary: repositoryAnswer.slice(0, 240),
        title: thread.title || buildThreadTitle(currentMessage),
      });

      const detail = await chatRepository.getThreadDetail(ownerUserId, thread.id);
      return NextResponse.json({
        mode: "grounded",
        groundingMode: metadata.groundingMode,
        scopeSnapshot: repositoryResult.scopeSnapshot,
        requestId,
        answer: repositoryAnswer,
        citations: repositoryCitations,
        toolResults,
        chart: repositoryCharts[0] ?? null,
        charts: repositoryCharts,
        execution: repositoryResult.execution ?? null,
        coverage: repositoryResult.coverage ?? null,
        limitations: repositoryLimitations,
        // Says so when the answer came from the cache rather than the models.
        // An answer that arrives in a second is either cached or wrong, and a
        // reader should not have to guess which.
        cached: repositoryResult.diagnostics.cached === true,
        jobId: repositoryResult.jobId ?? null,
        thread: detail.thread,
        messages: detail.messages,
        deepResearchSession: detail.deepResearchSession,
      });
    }
    throw new Error("The repository chat returned an unhandled request.");
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : "Unknown repository chat error";
    console.error("knowledge_chat_route", {
      requestId,
      stage: "repository_execution",
      fallbackReason: "repository_error",
      latencyMs: Date.now() - startedAt,
      ownerUserId,
      scopeKind: knowledgeScope.kind,
      projectId: knowledgeScope.projectId ?? null,
      folderId: knowledgeScope.folderId ?? null,
      message: failureMessage,
    });
    // A failed model call says what to do next - wait, narrow the question, or
    // top up the account - and "Please retry" is wrong for an empty account.
    const advice = error instanceof ModelCallError ? error.advice : null;
    const answer = advice
      ? `${advice.message} (Request ID \`${requestId}\`.)`
      : `I could not access the selected Papertrend knowledge scope for this request. Your papers were not replaced with a generic answer. Please retry, or report request ID \`${requestId}\` if the problem continues.`;
    await chatRepository.appendMessage({
      threadId: thread.id, ownerUserId, folderId: knowledgeScope.folderId, role: "assistant", content: answer,
      messageKind: "chat", citations: [], metadata: {
        mode: "fallback", groundingMode: "repository_unavailable", requestId,
        scopeSnapshot: preliminaryScopeSnapshot,
        repositoryLimitations: [failureMessage], failureStage: "repository_execution",
        ...(advice ? { failureKind: advice.kind } : {}),
      },
    });
    const detail = await chatRepository.getThreadDetail(ownerUserId, thread.id);
    return NextResponse.json({
      mode: "fallback", groundingMode: "repository_unavailable", answer, citations: [], toolResults: [],
      scopeSnapshot: preliminaryScopeSnapshot, requestId,
      limitations: advice ? [] : ["Repository knowledge was temporarily unavailable."],
      thread: detail.thread, messages: detail.messages, deepResearchSession: detail.deepResearchSession,
    });
  }
}

/** Answered when a session planned before deep research v2 is started: the worker it ran on is gone. */
const EARLIER_RESEARCH_MESSAGE =
  "This research was planned by an earlier version of Papertrend and can no longer be run. Ask the question again in Deep research to plan it afresh.";

async function handlePost(request: Request) {
  try {
    const body = parseChatRequestBody(await request.json().catch(() => ({})));
    const user = await getAuthenticatedUserFromRequest(request);
    const ownerUserId = user?.id ?? null;
    if (!ownerUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const chatMode = body.chatMode ?? "normal";
    const action = body.action ?? (chatMode === "deep_research" ? "plan" : "message");

    // Deep research v2 (docs/31), on Cloud SQL: a plan is one small call,
    // counted toward the token budget; starting a run costs one unit.
    if (chatMode === "deep_research") {
      if (getDatabaseProvider() !== "cloud-sql") {
        return NextResponse.json({ error: "Deep research needs the Cloud SQL workspace." }, { status: 501 });
      }
      const research = {
        message: body.message,
        threadId: body.threadId,
        sessionId: body.sessionId,
        projectId: body.projectId,
        folderId: body.folderId,
        selectedRunIds: body.selectedRunIds,
        knowledgeScope: body.knowledgeScope,
        attachments: body.attachments,
      };
      const detail =
        action === "cancel"
          ? await cancelResearch(research, ownerUserId)
          : action === "continue"
            ? await startResearch(research, ownerUserId, getPublicRequestOrigin(request))
            : await planResearch(research, ownerUserId);
      // Only a start returns nothing: the session is unknown, or was planned
      // before v2 and would have run on the Python worker, now removed.
      if (!detail) return NextResponse.json({ error: EARLIER_RESEARCH_MESSAGE }, { status: 409 });
      return NextResponse.json({
        mode: "deep_research",
        action,
        thread: detail.thread,
        messages: detail.messages,
        deepResearchSession: detail.deepResearchSession,
      });
    }

    return await normalChat(request, body, ownerUserId);
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("chat_request_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown chat request failure.",
    });
    return NextResponse.json(
      { error: "Chat request failed." },
      { status: 500 }
    );
  }
}

/**
 * Streams pipeline progress, then the same payload the JSON route returns.
 *
 * A repository answer takes several model calls, so a reader otherwise watches
 * a static spinner for half a minute. Clients opt in with
 * `Accept: text/event-stream`; everything else keeps the plain JSON response.
 */
/** The id Stop will name, when the client supplied a usable one. */
function cancellationId(request: Request): string | null {
  const header = request.headers.get("x-chat-request-id");
  return isValidRequestId(header) ? header : null;
}

/**
 * Records what one answer cost, in tokens and in money.
 *
 * Shared by the streaming and non-streaming paths so neither can quietly stop
 * recording. The streaming path did: its Response is returned before any model
 * call runs, so the usage scope wrapping it was always empty, and the UI
 * streams - which meant in practice no answer's cost was ever written down.
 *
 * A failure to record must never fail the answer. The reader asked a question,
 * not for bookkeeping.
 */
async function recordAnswerSpend(request: Request, usage: AiTokenUsageTotals): Promise<void> {
  if (usage.totalTokens <= 0) return;
  const spend = summarizeSpend(usage.byModel);
  // The provider's own figure when every call reported one: it includes web
  // search fees, which the token estimate cannot see.
  const charged = spendUsd(usage);
  console.info("chat_answer_spend", JSON.stringify({
    usd: charged.usd,
    usdSource: charged.source,
    estimatedUsd: spend.usd,
    totalTokens: usage.totalTokens,
    calls: usage.calls,
    byModel: spend.byModel,
    unpricedModels: spend.unpricedModels,
  }));
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    if (user?.id) await persistAiTokenUsage(user.id, usage);
  } catch (error) {
    console.error("chat_token_usage_persist_failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

/*
 * At most this many answers run at once for one person, per instance. The
 * token budget is read before an answer and recorded after it, so without a
 * cap, many requests sent together all pass the budget check and overshoot it.
 */
const MAX_CONCURRENT_ANSWERS_PER_USER = 2;
const answersInFlight = new Map<string, number>();

function claimAnswerSlot(userId: string): (() => void) | null {
  const current = answersInFlight.get(userId) ?? 0;
  if (current >= MAX_CONCURRENT_ANSWERS_PER_USER) return null;
  answersInFlight.set(userId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (answersInFlight.get(userId) ?? 1) - 1;
    if (next <= 0) answersInFlight.delete(userId);
    else answersInFlight.set(userId, next);
  };
}

function streamPostWithProgress(request: Request, releaseSlot: () => void = () => undefined): Response {
  // The work happens inside start(), after this function has already returned,
  // so the cancellation and latency scopes must be installed in there.
  const encoder = new TextEncoder();
  // A disconnect reaches a streaming route by one of two paths depending on the
  // runtime: the request signal aborts, or the stream the client was reading is
  // cancelled. Relying on the request signal alone left Stop working locally and
  // silently doing nothing behind the Cloud Run proxy, which kept paying for
  // model calls nobody would read. Listening for both and combining them means
  // whichever path the platform uses, the work stops.
  const readerLeft = new AbortController();
  const disconnected = AbortSignal.any([request.signal, readerLeft.signal]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // Stop cannot rely on the disconnect reaching this container, so the
      // request makes itself cancellable by name for as long as it runs.
      let unregister: (() => void) | null = null;
      const requestId = cancellationId(request);
      if (requestId) {
        const user = await getAuthenticatedUserFromRequest(request).catch(() => null);
        if (user) unregister = registerCancellable(user.id, requestId, readerLeft);
      }
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      // A comment frame opens the stream immediately so the client can render a
      // first stage without waiting for the first model call to finish.
      send(": open\n\n");
      const emit = (event: ChatProgressEvent) => send(encodeProgressFrame(event));
      try {
        const {
          value: { response, usage },
          timings,
        } = await runWithModelLatency(() =>
          runWithCancellation(disconnected, () =>
            withAiTokenUsageTracking(async (streamUsage) => ({
              response: await runWithChatProgress(emit, () => handlePost(request)),
              usage: streamUsage,
            }))
          )
        );
        await recordAnswerSpend(request, usage);
        if (timings.length > 0) {
          const summary = summarizeModelLatency(timings);
          console.info("chat_model_latency", JSON.stringify({
            totalMs: summary.totalMs,
            callCount: summary.callCount,
            byTask: summary.byTask,
            cancelled: disconnected.aborted,
          }));
        }
        const body = await response.clone().text();
        let payload: unknown;
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          payload = { error: "The answer could not be read." };
        }
        if (response.ok) send(encodeResultFrame(payload));
        else {
          const message =
            typeof payload === "object" && payload && "error" in payload
              ? String((payload as { error: unknown }).error)
              : "The request failed.";
          send(encodeErrorFrame(message, response.status));
        }
      } catch (error) {
        // "The request failed." told a reader nothing: whether to wait, to
        // narrow the question, or to tell the owner the account is out of
        // credit. Each needs a different action, so each gets its own message.
        const advice =
          error instanceof ModelCallError
            ? error.advice
            : adviseOnFailure({
                message: error instanceof Error ? error.message : String(error),
                aborted: disconnected.aborted,
              });
        console.info("chat_failure", JSON.stringify({
          kind: advice.kind,
          retryable: advice.retryable,
          detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        }));
        send(encodeErrorFrame(advice.message, advice.kind === "unauthorized" ? 401 : 500));
      } finally {
        closed = true;
        unregister?.();
        releaseSlot();
        try {
          controller.close();
        } catch {
          // Already closed by a disconnecting client.
        }
      }
    },
    cancel() {
      // The reader went away. Nothing will read what the remaining model calls
      // would produce, so stop them rather than finishing the answer in private.
      readerLeft.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Allows the browser to reach this endpoint directly on the Cloud Run origin. */
export async function OPTIONS(request: Request) {
  return chatCorsPreflight(request);
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  // Every answer spends model credit, so only a signed-in person may ask. An
  // anonymous caller used to fall through to a general answer from the paid
  // model, with web search available and no budget counted.
  if (!user?.id) {
    return withChatCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request);
  }
  try {
    await assertAiTokenBudget(user.id);
  } catch (error) {
    if (error instanceof GuardError) {
      return withChatCors(
        NextResponse.json({ error: error.message }, { status: error.status }),
        request
      );
    }
    throw error;
  }

  const wantsStream = (request.headers.get("accept") ?? "").includes("text/event-stream");

  const releaseSlot = claimAnswerSlot(user.id);
  if (!releaseSlot) {
    return withChatCors(
      NextResponse.json(
        { error: "Two answers are already being written for you. Wait for one to finish, then ask again." },
        { status: 429 }
      ),
      request
    );
  }

  return withAiTokenUsageTracking(async (usage) => {
    let streaming = false;
    try {
      if (wantsStream) {
        // The stream releases the slot itself, when its work ends.
        streaming = true;
        return withChatCors(streamPostWithProgress(request, releaseSlot), request);
      }
      const { value: response, timings } = await runWithModelLatency(() =>
        runWithCancellation(request.signal, () => handlePost(request))
      );
      if (timings.length > 0) {
        const summary = summarizeModelLatency(timings);
        console.info("chat_model_latency", JSON.stringify({
          totalMs: summary.totalMs,
          callCount: summary.callCount,
          byTask: summary.byTask,
          cancelled: request.signal.aborted,
        }));
      }
      return withChatCors(response, request);
    } finally {
      // The streaming branch records its own spend inside the stream, where the
      // work actually happens; this covers the JSON path.
      if (!wantsStream) await recordAnswerSpend(request, usage);
      if (!streaming) releaseSlot();
    }
  });
}
