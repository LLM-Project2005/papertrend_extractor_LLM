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
  selectedRunIds?: string[];
  threadId?: string;
  folderId?: string | "all";
  projectId?: string;
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

type LocalPlanPaper = {
  paper_id: number;
  title: string;
  year?: string | null;
};

function extractQuotedTitle(prompt: string) {
  const matches = prompt.match(/"([^"]{8,})"|'([^']{8,})'/);
  return (matches?.[1] ?? matches?.[2] ?? "").trim();
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchQuery(prompt: string, quotedTitle: string) {
  if (quotedTitle) {
    return quotedTitle;
  }
  return prompt
    .replace(/\b(do|please|can you|could you|run|perform)\b/gi, " ")
    .split(/\b(first create|then identify|finish with|using the selected folder scope|step-by-step plan)\b/i)[0]
    .replace(/\b(deep research|analysis|structured report|report)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,:;]+$/, "");
}

function detectRequestedSections(prompt: string) {
  const lowered = prompt.toLowerCase();
  const sections = [
    ["objective", ["objective", "objectives", "aim", "purpose"]],
    ["theoretical_background", ["theoretical background", "background", "framework", "literature"]],
    ["methodology", ["methodology", "methods", "method", "design"]],
    ["participants", ["participants", "participant", "learners", "students", "sample"]],
    ["key_findings", ["key findings", "findings", "results", "outcomes"]],
    ["limitations", ["limitations", "limitation", "constraints", "weakness"]],
    ["implications", ["implications", "implication", "significance"]],
  ] as const;
  return sections
    .filter(([, aliases]) => aliases.some((alias) => lowered.includes(alias)))
    .map(([section]) => section);
}

function titleMatchStrength(targetTitle: string, paperTitle: string) {
  const normalizedTarget = normalizeTitle(targetTitle);
  const normalizedPaperTitle = normalizeTitle(paperTitle);
  if (!normalizedTarget || !normalizedPaperTitle) {
    return { strong: false, score: 0 };
  }
  if (normalizedTarget === normalizedPaperTitle) {
    return { strong: true, score: 200 };
  }
  const targetTokens = new Set(normalizedTarget.split(" ").filter(Boolean));
  const titleTokens = new Set(normalizedPaperTitle.split(" ").filter(Boolean));
  let overlap = 0;
  targetTokens.forEach((token) => {
    if (titleTokens.has(token)) overlap += 1;
  });
  const ratio = overlap / Math.max(1, targetTokens.size);
  const strong =
    ratio >= 0.8 ||
    (targetTokens.size >= 4 && normalizedPaperTitle.includes(normalizedTarget));
  return { strong, score: Math.round(ratio * 120) };
}

function buildLocalPromptAnalysis(prompt: string, papers: LocalPlanPaper[]) {
  const quotedTitle = extractQuotedTitle(prompt);
  const normalizedQuery = normalizeSearchQuery(prompt, quotedTitle);
  const lowered = prompt.toLowerCase();
  const rankedMatches = papers
    .map((paper) => {
      const match = titleMatchStrength(quotedTitle, paper.title);
      return {
        paperId: paper.paper_id,
        title: paper.title,
        year: paper.year ?? "Unknown",
        score: match.score,
        strong_title_match: match.strong,
      };
    })
    .filter((row) => row.score > 0 || row.strong_title_match)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const target = rankedMatches.find((row) => row.strong_title_match);
  return {
    single_paper: Boolean(quotedTitle),
    compare: /\b(compare|comparison|versus|contrast)\b/i.test(prompt),
    survey: /\b(survey|review|overview|landscape|corpus|literature)\b/i.test(prompt),
    methodology_focus: /\b(method|methods|methodology|participants|sample)\b/i.test(prompt),
    findings_focus: /\b(findings|results|outcomes)\b/i.test(prompt),
    limitations_focus: /\b(limitation|limitations|constraint|weakness)\b/i.test(prompt),
    evidence_extraction:
      detectRequestedSections(prompt).length > 0 || /\b(evidence|cite|quote)\b/i.test(prompt),
    quoted_title: quotedTitle,
    candidate_title: quotedTitle,
    normalized_query: normalizedQuery || prompt.trim(),
    requested_sections: detectRequestedSections(prompt),
    target_in_scope: Boolean(target),
    target_paper_id: target?.paperId ?? 0,
    ranked_matches: rankedMatches,
  };
}

async function loadScopedPlanPapers(
  ownerUserId: string,
  folderId: string | "all" | undefined,
  projectId: string | undefined
): Promise<LocalPlanPaper[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("papers_full")
    .select("paper_id,title,year,folder_id")
    .eq("owner_user_id", ownerUserId);

  if (folderId && folderId !== "all") {
    query = query.eq("folder_id", folderId);
  } else if (projectId) {
    const { data: folders, error: folderError } = await supabase
      .from("research_folders")
      .select("id")
      .eq("owner_user_id", ownerUserId)
      .eq("project_id", projectId);
    if (folderError) {
      throw new Error(folderError.message);
    }
    const folderIds = (folders ?? [])
      .map((row) => String((row as { id?: string | null }).id ?? ""))
      .filter(Boolean);
    if (folderIds.length === 0) {
      return [];
    }
    query = query.in("folder_id", folderIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as LocalPlanPaper[];
}

async function buildLocalResearchPlan(
  prompt: string,
  pendingRunCount: number,
  ownerUserId: string,
  folderId: string | "all" | undefined,
  projectId: string | undefined
) {
  const papers = await loadScopedPlanPapers(ownerUserId, folderId, projectId);
  const promptAnalysis = buildLocalPromptAnalysis(prompt, papers);
  const baseToolInput = {
    projectId: projectId ?? "",
    promptAnalysis,
    targetTitle: promptAnalysis.candidate_title || undefined,
    targetPaperId: promptAnalysis.target_paper_id || undefined,
  };
  const needsAnalysis = pendingRunCount > 0;

  if (promptAnalysis.single_paper && promptAnalysis.candidate_title) {
    if (promptAnalysis.target_in_scope) {
      return {
        title: buildThreadTitle(promptAnalysis.candidate_title),
        summary: needsAnalysis
          ? `Analyze the pending files first, then read "${promptAnalysis.candidate_title}" directly and widen only if supporting context is needed.`
          : `Read "${promptAnalysis.candidate_title}" directly first, then widen only if supporting context is needed.`,
        requires_analysis: needsAnalysis,
        pending_run_count: pendingRunCount,
        steps: [
          {
            position: 1,
            title: "Read the named paper first",
            description: "Open the requested paper directly and extract the sections needed for the report.",
            tool_name: "read_paper_sections",
            tool_input: {
              ...baseToolInput,
              paperIds: [promptAnalysis.target_paper_id],
              query: promptAnalysis.candidate_title,
              limit: 1,
              requestedSections: promptAnalysis.requested_sections,
            },
          },
          {
            position: 2,
            title: "Pull only supporting context",
            description: "Retrieve adjacent in-scope papers only if they help frame background or comparison.",
            tool_name: "fetch_papers",
            tool_input: {
              ...baseToolInput,
              query: promptAnalysis.normalized_query,
              limit: 4,
              excludePaperIds: [promptAnalysis.target_paper_id],
            },
          },
        ],
      };
    }

    return {
      title: buildThreadTitle(promptAnalysis.candidate_title),
      summary: needsAnalysis
        ? `Analyze the pending files first, then verify whether "${promptAnalysis.candidate_title}" exists in the selected scope and report the closest matches.`
        : `Verify whether "${promptAnalysis.candidate_title}" exists in the selected scope and report the closest matches.`,
      requires_analysis: needsAnalysis,
      pending_run_count: pendingRunCount,
      steps: [
        {
          position: 1,
          title: "Verify scope coverage",
          description: "Check whether the named paper is actually present in the selected scope.",
          tool_name: "list_folder_papers",
          tool_input: { ...baseToolInput, limit: 12 },
        },
        {
          position: 2,
          title: "Surface closest in-scope matches",
          description: "Find the nearest in-scope title matches so the final report can explain the gap clearly.",
          tool_name: "fetch_papers",
          tool_input: { ...baseToolInput, query: promptAnalysis.candidate_title, limit: 5 },
        },
      ],
    };
  }

  if (promptAnalysis.compare) {
    return {
      title: buildThreadTitle(promptAnalysis.normalized_query),
      summary: needsAnalysis
        ? `Analyze the pending files first, then identify the strongest comparison papers for "${promptAnalysis.normalized_query}".`
        : `Identify the strongest comparison papers for "${promptAnalysis.normalized_query}" and extract section-level evidence.`,
      requires_analysis: needsAnalysis,
      pending_run_count: pendingRunCount,
      steps: [
        {
          position: 1,
          title: "Retrieve comparison papers",
          description: "Find the strongest in-scope papers that match the comparison request.",
          tool_name: "fetch_papers",
          tool_input: { ...baseToolInput, query: promptAnalysis.normalized_query, limit: 6 },
        },
        {
          position: 2,
          title: "Read comparable sections",
          description: "Inspect methods, results, and conclusions that support direct comparison.",
          tool_name: "read_paper_sections",
          tool_input: { ...baseToolInput, query: promptAnalysis.normalized_query, limit: 4 },
        },
      ],
    };
  }

  if (promptAnalysis.survey || papers.length >= 8) {
    return {
      title: buildThreadTitle(promptAnalysis.normalized_query),
      summary: needsAnalysis
        ? `Analyze the pending files first, then map the scoped corpus for "${promptAnalysis.normalized_query}".`
        : `Map the scoped corpus for "${promptAnalysis.normalized_query}", retrieve the strongest papers, and synthesize section-level evidence.`,
      requires_analysis: needsAnalysis,
      pending_run_count: pendingRunCount,
      steps: [
        {
          position: 1,
          title: "Map the scoped corpus",
          description: "List the in-scope papers first so the review stays grounded in the current workspace.",
          tool_name: "list_folder_papers",
          tool_input: { ...baseToolInput, limit: 15 },
        },
        {
          position: 2,
          title: "Pull the strongest papers",
          description: "Retrieve the most relevant papers for the topic without echoing the full instruction prompt into search.",
          tool_name: "fetch_papers",
          tool_input: { ...baseToolInput, query: promptAnalysis.normalized_query, limit: 6 },
        },
        {
          position: 3,
          title: "Read the most relevant sections",
          description: "Inspect the sections that carry the evidence the user asked for.",
          tool_name: "read_paper_sections",
          tool_input: { ...baseToolInput, query: promptAnalysis.normalized_query, limit: 4 },
        },
      ],
    };
  }

  return {
    title: buildThreadTitle(promptAnalysis.normalized_query || prompt),
    summary: needsAnalysis
      ? `Analyze the pending files first, then retrieve the most relevant in-scope papers for "${promptAnalysis.normalized_query || prompt}".`
      : `Retrieve the most relevant in-scope papers for "${promptAnalysis.normalized_query || prompt}" and answer from their sections directly.`,
    requires_analysis: needsAnalysis,
    pending_run_count: pendingRunCount,
    steps: [
      {
        position: 1,
        title: "Retrieve relevant papers",
        description: "Find the in-scope papers that most directly answer the request.",
        tool_name: "fetch_papers",
        tool_input: {
          ...baseToolInput,
          query: promptAnalysis.normalized_query || prompt,
          limit: 5,
        },
      },
      {
        position: 2,
        title: "Read the requested evidence",
        description: "Inspect the paper sections most likely to contain the answer instead of relying on broad workspace analytics.",
        tool_name: "read_paper_sections",
        tool_input: {
          ...baseToolInput,
          query: promptAnalysis.normalized_query || prompt,
          limit: 3,
          requestedSections: promptAnalysis.requested_sections,
        },
      },
    ],
  };
}

async function countPendingRuns(
  folderId: string | "all" | undefined,
  projectId: string | undefined,
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
  } else if (projectId) {
    const { data: folders, error: foldersError } = await supabase
      .from("research_folders")
      .select("id")
      .eq("owner_user_id", ownerUserId)
      .eq("project_id", projectId);
    if (foldersError) {
      throw new Error(foldersError.message);
    }
    const folderIds = (folders ?? [])
      .map((row) => String((row as { id?: string | null }).id ?? ""))
      .filter(Boolean);
    if (folderIds.length === 0) {
      return 0;
    }
    query = query.in("folder_id", folderIds);
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
      projectId: body.projectId,
      message: prompt,
    });
  } catch {
    rawPlan = null;
  }

  const pendingRunCount = await countPendingRuns(
    body.folderId,
    body.projectId,
    ownerUserId
  );
  const plan =
    rawPlan ??
    (await buildLocalResearchPlan(
      prompt,
      pendingRunCount,
      ownerUserId,
      body.folderId,
      body.projectId
    ));
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
  const pendingRunCount = await countPendingRuns(
    body.folderId,
    body.projectId,
    ownerUserId
  );
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
        body.folderId && body.folderId !== "all" ? body.folderId : null,
        body.projectId ?? null,
        body.selectedRunIds ?? []
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
