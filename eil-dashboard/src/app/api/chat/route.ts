import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  appendWorkspaceMessage,
  buildThreadTitle,
  createWorkspaceThread,
  getWorkspaceThreadDetail,
  replaceDeepResearchPlan,
  updateWorkspaceThread,
} from "@/lib/chat-store";
import {
  buildDeterministicGroundedAnswer,
  buildGroundedContext,
  retrieveCorpusPapers,
} from "@/lib/corpus";
import { createChatCompletion } from "@/lib/openai";
import { callPythonNodeService } from "@/lib/python-node-service";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerResearchQueue, triggerWorkerQueue } from "@/lib/worker-trigger";
import type {
  ChatThreadDetail,
  DeepResearchSessionRecord,
} from "@/types/research";

export const runtime = "nodejs";

interface Citation {
  paperId: number;
  title: string;
  year: string;
  href: string;
  reason: string;
}

interface ChatRequestBody {
  message?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  attachments?: Array<{
    name: string;
    type?: string;
    size?: number;
  }>;
  selectedYears?: string[];
  selectedTracks?: string[];
  searchQuery?: string;
  queryLanguage?: string;
  threadId?: string;
  folderId?: string | "all";
  chatMode?: "normal" | "deep_research";
  action?: "message" | "plan" | "continue";
  sessionId?: string;
}

function buildFallbackAnswer(question: string, corpusError?: string): string {
  const lines = [
    "Broader guidance beyond the corpus:",
    `I could not find a direct answer to "${question}" in the stored workspace paper data.`,
    "A useful next step is to narrow the question by topic, year, track, folder, or a specific paper title so the answer can be grounded in the dataset.",
  ];

  if (corpusError) {
    lines.push(`Corpus note: ${corpusError}`);
  }

  return lines.join("\n");
}

function buildLocalResearchPlan(prompt: string, pendingRunCount: number) {
  return {
    title: buildThreadTitle(prompt),
    summary:
      pendingRunCount > 0
        ? `Analyze the pending folder files first, then complete a staged corpus review for "${prompt}".`
        : `Run a staged corpus review for "${prompt}" using the selected folder scope.`,
    requires_analysis: pendingRunCount > 0,
    pending_run_count: pendingRunCount,
    steps: [
      {
        position: 1,
        title: "Map the scoped corpus",
        description: "List the papers inside the current folder scope before drilling down.",
        tool_name: "list_folder_papers",
        tool_input: { limit: 12 },
      },
      {
        position: 2,
        title: "Inspect workspace analytics",
        description: "Review high-level trends and coverage to orient the research.",
        tool_name: "get_dashboard_summary",
        tool_input: { focus: "overview" },
      },
      {
        position: 3,
        title: "Pull supporting papers",
        description: "Fetch the most relevant papers and sections for the request.",
        tool_name: "fetch_papers",
        tool_input: { query: prompt, limit: 5 },
      },
    ],
  };
}

async function countPendingRuns(
  folderId: string | "all" | undefined,
  ownerUserId: string,
) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("ingestion_runs")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", ownerUserId)
    .in("status", ["queued", "processing"]);

  if (folderId && folderId !== "all") {
    query = query.eq("folder_id", folderId);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function planDeepResearch(
  body: ChatRequestBody,
  ownerUserId: string
): Promise<NextResponse> {
  const prompt = body.message?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const thread =
    body.threadId
      ? (await getWorkspaceThreadDetail(supabase, ownerUserId, body.threadId)).thread
      : await createWorkspaceThread(supabase, {
          ownerUserId,
          folderId: body.folderId,
          mode: "deep_research",
          title: buildThreadTitle(prompt),
          summary: "Planning deep research session",
        });

  if (!body.threadId) {
    await appendWorkspaceMessage(supabase, {
      threadId: thread.id,
      ownerUserId,
      folderId: body.folderId,
      role: "user",
      content: prompt,
      messageKind: "chat",
      metadata: { chatMode: "deep_research" },
    });
  }

  let rawPlan:
    | {
        title?: string;
        summary?: string;
        requires_analysis?: boolean;
        pending_run_count?: number;
        steps?: Array<{
          position?: number;
          title?: string;
          description?: string;
          tool_name?: string;
          tool_input?: Record<string, unknown>;
        }>;
      }
    | null = null;

  try {
    rawPlan = await callPythonNodeService<{
      title?: string;
      summary?: string;
      requires_analysis?: boolean;
      pending_run_count?: number;
      steps?: Array<{
        position?: number;
        title?: string;
        description?: string;
        tool_name?: string;
        tool_input?: Record<string, unknown>;
      }>;
    }>("/research-plan", {
      ownerUserId,
      folderId: body.folderId,
      message: prompt,
    });
  } catch {
    rawPlan = null;
  }

  const pendingRunCount = await countPendingRuns(body.folderId, ownerUserId);
  const plan = rawPlan ?? buildLocalResearchPlan(prompt, pendingRunCount);
  const session = await replaceDeepResearchPlan(supabase, {
    threadId: thread.id,
    ownerUserId,
    folderId: body.folderId,
    sessionId: body.sessionId,
    prompt,
    title: String(plan.title || buildThreadTitle(prompt)),
    summary: String(plan.summary || `Deep research plan for "${prompt}"`),
    requiresAnalysis:
      typeof plan.requires_analysis === "boolean"
        ? plan.requires_analysis
        : pendingRunCount > 0,
    pendingRunCount:
      typeof plan.pending_run_count === "number"
        ? plan.pending_run_count
        : pendingRunCount,
    steps: (plan.steps ?? []).map((step, index) => ({
      position: Number(step.position ?? index + 1),
      title: String(step.title || `Step ${index + 1}`),
      description: String(step.description || "Research this part of the request."),
      tool_name: String(step.tool_name || "fetch_papers"),
      tool_input:
        step.tool_input && typeof step.tool_input === "object"
          ? step.tool_input
          : { query: prompt, limit: 5 },
    })),
  });

  const detail = await getWorkspaceThreadDetail(supabase, ownerUserId, thread.id);
  return NextResponse.json({
    mode: "deep_research",
    action: "plan",
    thread: detail.thread,
    messages: detail.messages,
    deepResearchSession: session,
  });
}

async function continueDeepResearch(
  body: ChatRequestBody,
  ownerUserId: string
): Promise<NextResponse> {
  if (!body.threadId || !body.sessionId) {
    return NextResponse.json(
      { error: "threadId and sessionId are required for deep research continue." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const pendingRunCount = await countPendingRuns(body.folderId, ownerUserId);
  const nextStatus = pendingRunCount > 0 ? "waiting_on_analysis" : "queued";

  const { error } = await supabase
    .from("deep_research_sessions")
    .update({
      status: nextStatus,
      pending_run_count: pendingRunCount,
      requires_analysis: pendingRunCount > 0,
      last_error: null,
      updated_at: new Date().toISOString(),
      completed_at: null,
    })
    .eq("id", body.sessionId)
    .eq("owner_user_id", ownerUserId);

  if (error) {
    throw new Error(error.message);
  }

  if (pendingRunCount > 0) {
    await triggerWorkerQueue({
      maxRuns: 2,
      reason: "deep-research-waiting-on-analysis",
    }).catch(() => null);
  } else {
    await triggerResearchQueue({
      maxRuns: 1,
      reason: "deep-research-continue",
    }).catch(() => null);
  }

  const detail = await getWorkspaceThreadDetail(supabase, ownerUserId, body.threadId);
  return NextResponse.json({
    mode: "deep_research",
    action: "continue",
    thread: detail.thread,
    messages: detail.messages,
    deepResearchSession: detail.deepResearchSession,
  });
}

async function normalChat(
  request: Request,
  body: ChatRequestBody,
  ownerUserId: string | null
): Promise<NextResponse> {
  const currentMessage =
    body.message ??
    [...(body.messages ?? [])]
      .reverse()
      .find((message) => message.role === "user")?.content;

  if (!currentMessage?.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const attachmentContext =
    body.attachments && body.attachments.length > 0
      ? `\n\nAttached files:\n${body.attachments
          .map((file, index) => {
            const fileType = file.type?.trim() || "unknown";
            const fileSize =
              typeof file.size === "number" ? `, ${Math.max(file.size, 0)} bytes` : "";
            return `${index + 1}. ${file.name} (${fileType}${fileSize})`;
          })
          .join("\n")}`
      : "";

  const supabase = ownerUserId ? getSupabaseAdmin() : null;
  let thread: ChatThreadDetail["thread"] | null = null;
  if (ownerUserId && supabase) {
    thread = body.threadId
      ? (await getWorkspaceThreadDetail(supabase, ownerUserId, body.threadId)).thread
      : await createWorkspaceThread(supabase, {
          ownerUserId,
          folderId: body.folderId,
          mode: "normal",
          title: buildThreadTitle(currentMessage),
          summary: currentMessage.slice(0, 180),
        });

    await appendWorkspaceMessage(supabase, {
      threadId: thread.id,
      ownerUserId,
      folderId: body.folderId,
      role: "user",
      content: currentMessage,
      messageKind: "chat",
      metadata: { attachments: body.attachments ?? [] },
    });
  }

  let proxied:
    | {
        answer?: string;
        mode?: "grounded" | "fallback";
        citations?: Citation[];
        suggestedConcepts?: string[];
      }
    | null = null;

  try {
    proxied = await callPythonNodeService<{
      answer?: string;
      mode?: "grounded" | "fallback";
      citations?: Citation[];
      suggestedConcepts?: string[];
    }>("/chat", { ...body, ownerUserId });
  } catch {
    proxied = null;
  }

  let answer = proxied?.answer ?? "";
  let mode = proxied?.mode ?? "fallback";
  let citations = proxied?.citations ?? [];

  if (!answer) {
    let papers: Awaited<ReturnType<typeof retrieveCorpusPapers>>["papers"] = [];
    let corpusError: string | undefined;

    try {
      const corpus = await retrieveCorpusPapers(
        currentMessage,
        ownerUserId,
        body.folderId && body.folderId !== "all" ? body.folderId : null
      );
      papers = corpus.papers;
      citations = corpus.citations;
    } catch (error) {
      corpusError = error instanceof Error ? error.message : "Corpus retrieval failed.";
    }

    if (papers.length > 0) {
      const context = buildGroundedContext(papers);
      const llmAnswer = await createChatCompletion(
        [
          {
            role: "system",
            content:
              "You are the chat assistant for a research workspace. Answer from the supplied corpus context first. Cite papers inline as [Paper <id>]. If the corpus is insufficient, add a final section titled 'Broader guidance beyond the corpus'. Do not invent citations.",
          },
          {
            role: "user",
            content: `Question:\n${currentMessage}${attachmentContext}\n\nCorpus context:\n${context}`,
          },
        ],
        0.2,
        body.model,
        "CHAT_SYNTHESIS"
      );
      answer = llmAnswer ?? buildDeterministicGroundedAnswer(currentMessage, papers);
      mode = "grounded";
    } else {
      const fallbackPrompt = [
        {
          role: "system" as const,
          content:
            "You are the chat assistant for a research workspace. The stored corpus does not directly answer the user's request. Provide careful broader guidance, and begin the answer with the heading 'Broader guidance beyond the corpus:'.",
        },
        {
          role: "user" as const,
          content: `${currentMessage}${attachmentContext}`,
        },
      ];

      answer =
        (await createChatCompletion(fallbackPrompt, 0.4, body.model, "CHAT_SYNTHESIS")) ??
        buildFallbackAnswer(currentMessage, corpusError);
      mode = "fallback";
    }
  }

  if (ownerUserId && supabase && thread) {
    await appendWorkspaceMessage(supabase, {
      threadId: thread.id,
      ownerUserId,
      folderId: body.folderId,
      role: "assistant",
      content: answer,
      messageKind: "chat",
      citations,
      metadata: { mode },
    });
    await updateWorkspaceThread(supabase, thread.id, {
      summary: answer.slice(0, 240),
      title: thread.title || buildThreadTitle(currentMessage),
    });

    const detail = await getWorkspaceThreadDetail(supabase, ownerUserId, thread.id);
    return NextResponse.json({
      mode,
      answer,
      citations,
      thread: detail.thread,
      messages: detail.messages,
      deepResearchSession: detail.deepResearchSession,
    });
  }

  return NextResponse.json({
    mode,
    answer,
    citations,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const user = await getAuthenticatedUserFromRequest(request);
    const ownerUserId = user?.id ?? null;
    const chatMode = body.chatMode ?? "normal";
    const action = body.action ?? (chatMode === "deep_research" ? "plan" : "message");

    if (chatMode === "deep_research") {
      if (!ownerUserId) {
        return NextResponse.json(
          { error: "Sign in to use deep research mode." },
          { status: 401 }
        );
      }
      if (action === "continue") {
        return await continueDeepResearch(body, ownerUserId);
      }
      return await planDeepResearch(body, ownerUserId);
    }

    return await normalChat(request, body, ownerUserId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed." },
      { status: 500 }
    );
  }
}
