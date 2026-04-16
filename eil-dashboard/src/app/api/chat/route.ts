import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  appendWorkspaceMessage,
  buildThreadTitle,
  createWorkspaceThread,
  getDeepResearchSession,
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
  paperId: number | string;
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

function normalizeIdList(values: string[] = []) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeOptionalScopeId(value?: string | null) {
  if (!value || value === "all") {
    return "";
  }
  return value.trim();
}

async function resolveReusableDeepResearchSessionId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  body: ChatRequestBody,
): Promise<string | undefined> {
  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return undefined;
  }

  let existing: DeepResearchSessionRecord;
  try {
    existing = await getDeepResearchSession(supabase, sessionId);
  } catch {
    return undefined;
  }

  if (String(existing.owner_user_id ?? "") !== ownerUserId) {
    return undefined;
  }

  const firstStep = existing.steps?.[0];
  const inputPayload =
    firstStep?.input_payload && typeof firstStep.input_payload === "object"
      ? firstStep.input_payload
      : null;

  const previousPrompt = String(existing.prompt ?? "").trim();
  const nextPrompt = String(body.message ?? "").trim();
  const previousFolderId = normalizeOptionalScopeId(existing.folder_id ?? null);
  const nextFolderId = normalizeOptionalScopeId(body.folderId);
  const previousProjectId =
    inputPayload && typeof inputPayload.projectId === "string"
      ? normalizeOptionalScopeId(inputPayload.projectId)
      : "";
  const nextProjectId = normalizeOptionalScopeId(body.projectId);
  const previousRunIds =
    inputPayload && Array.isArray(inputPayload.selectedRunIds)
      ? normalizeIdList(inputPayload.selectedRunIds.map((value) => String(value)))
      : [];
  const nextRunIds = normalizeIdList(body.selectedRunIds ?? []);

  const samePrompt = previousPrompt === nextPrompt;
  const sameFolder = previousFolderId === nextFolderId;
  const sameProject = previousProjectId === nextProjectId;
  const sameRuns =
    previousRunIds.length === nextRunIds.length &&
    previousRunIds.every((value, index) => value === nextRunIds[index]);

  return samePrompt && sameFolder && sameProject && sameRuns ? sessionId : undefined;
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
  ingestion_run_id?: string | null;
};

const LOCAL_PAYLOAD_VERSION = 2;
const LOCAL_PLANNER_VERSION = "hybrid-v1";
const SECTION_TO_QUERY: Record<string, string> = {
  objective: "research objective",
  theoretical_background: "theoretical background",
  methodology: "methodology methods design",
  participants: "participants sample learners students",
  key_findings: "results findings outcomes",
  limitations: "limitations weaknesses constraints",
  implications: "implications significance practice",
};

function extractQuotedTitle(prompt: string) {
  const matches = prompt.match(/"([^"]{8,})"|'([^']{8,})'/);
  return (matches?.[1] ?? matches?.[2] ?? "").trim();
}

function extractCandidateTitle(prompt: string) {
  const quoted = extractQuotedTitle(prompt);
  if (quoted) return quoted;
  const truncated = prompt
    .replace(/\s+/g, " ")
    .trim()
    .split(/\b(first create|then identify|finish with|using the selected folder scope|step-by-step plan)\b/i)[0]
    .trim();
  const patterns = [
    /\bdeep research analysis of\s+(.+)$/i,
    /\banalysis of\s+(.+)$/i,
    /\banalyze\s+(.+)$/i,
    /\banalyse\s+(.+)$/i,
    /\bresearch\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = truncated.match(pattern);
    const candidate = (match?.[1] ?? "").trim().replace(/[.,:;]+$/, "");
    if (candidate.length >= 12) {
      return candidate;
    }
  }
  return "";
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchQuery(prompt: string, candidateTitle: string) {
  if (candidateTitle) {
    return candidateTitle;
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

function isExactNormalizedTitleMatch(targetTitle: string, paperTitle: string) {
  const normalizedTarget = normalizeTitle(targetTitle);
  const normalizedPaperTitle = normalizeTitle(paperTitle);
  return Boolean(normalizedTarget) && normalizedTarget === normalizedPaperTitle;
}

function buildLocalPromptAnalysis(
  prompt: string,
  papers: LocalPlanPaper[],
  selectedRunIds: string[] = []
) {
  const candidateTitle = extractCandidateTitle(prompt);
  const quotedTitle = extractQuotedTitle(prompt);
  const normalizedQuery = normalizeSearchQuery(prompt, candidateTitle);
  const lowered = prompt.toLowerCase();
  const requestedSections = detectRequestedSections(prompt);
  const compare = /\b(compare|comparison|versus|contrast)\b/i.test(prompt);
  const survey = /\b(survey|review|overview|landscape|corpus|literature)\b/i.test(prompt);
  const evidenceExtraction =
    requestedSections.length > 0 || /\b(evidence|cite|quote)\b/i.test(prompt);
  const rankedMatches = papers
    .map((paper) => {
      const match = titleMatchStrength(candidateTitle, paper.title);
      return {
        paperId: paper.paper_id,
        title: paper.title,
        year: paper.year ?? "Unknown",
        score: match.score,
        strong_title_match: match.strong,
        exact_normalized_title_match: isExactNormalizedTitleMatch(candidateTitle, paper.title),
        ingestion_run_id: paper.ingestion_run_id ?? null,
      };
    })
    .filter((row) => row.score > 0 || row.strong_title_match)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  let target =
    rankedMatches.find((row) => row.exact_normalized_title_match) ??
    rankedMatches.find((row) => row.strong_title_match);
  if (!target && candidateTitle && selectedRunIds.length > 0) {
    const selectedMatches = papers
      .filter((paper) => selectedRunIds.includes(String(paper.ingestion_run_id ?? "")))
      .map((paper) => {
        const match = titleMatchStrength(candidateTitle, paper.title);
        return {
          paperId: paper.paper_id,
          title: paper.title,
          year: paper.year ?? "Unknown",
          score: match.score,
          strong_title_match: match.strong,
          exact_normalized_title_match: isExactNormalizedTitleMatch(candidateTitle, paper.title),
          ingestion_run_id: paper.ingestion_run_id ?? null,
        };
      });
    target =
      selectedMatches.find((row) => row.exact_normalized_title_match) ??
      selectedMatches.find((row) => row.strong_title_match);
    if (!target && selectedMatches.length === 1) {
      const normalizedTargetTokens = new Set(normalizeTitle(candidateTitle).split(" ").filter(Boolean));
      const normalizedOnlyTokens = new Set(normalizeTitle(selectedMatches[0].title).split(" ").filter(Boolean));
      let overlap = 0;
      normalizedTargetTokens.forEach((token) => {
        if (normalizedOnlyTokens.has(token)) overlap += 1;
      });
      const ratio = overlap / Math.max(1, normalizedTargetTokens.size);
      if (ratio >= 0.75) {
        target = {
          ...selectedMatches[0],
          score: Math.max(selectedMatches[0].score, 80),
          strong_title_match: true,
        };
      }
    }
  }
  const trivial =
    !compare &&
    requestedSections.length === 0 &&
    !survey &&
    (!candidateTitle || Boolean(target));
  return {
    single_paper: Boolean(candidateTitle),
    compare,
    survey,
    methodology_focus: /\b(method|methods|methodology|participants|sample)\b/i.test(prompt),
    findings_focus: /\b(findings|results|outcomes)\b/i.test(prompt),
    limitations_focus: /\b(limitation|limitations|constraint|weakness)\b/i.test(prompt),
    evidence_extraction: evidenceExtraction,
    quoted_title: quotedTitle,
    candidate_title: candidateTitle,
    normalized_query: normalizedQuery || prompt.trim(),
    requested_sections: requestedSections,
    target_in_scope: Boolean(target),
    target_paper_id: target?.paperId ?? 0,
    ranked_matches: rankedMatches,
    primary_intent: candidateTitle
      ? "paper_lookup"
      : compare
        ? "comparison"
        : evidenceExtraction
          ? "evidence_audit"
          : "topic_review",
    target_entity_type: candidateTitle ? "paper" : "topic",
    requested_output_mode:
      requestedSections.length > 0
        ? "structured_sections"
        : compare
          ? "comparison"
          : survey
            ? "narrative_review"
            : "plain_summary",
    scope_mode: trivial ? "trivial" : survey ? "broad" : "medium",
    target_resolution_status: candidateTitle
      ? target
        ? "exact_match"
        : rankedMatches.length > 0
          ? "probable_match"
          : "missing"
      : rankedMatches.length > 0
        ? "probable_match"
        : "unresolved",
    normalized_topic_terms: normalizedQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 10),
    exclusion_ids: [],
  };
}

function slugifyTodo(value: string) {
  return normalizeTitle(value).replace(/\s+/g, "-").slice(0, 48) || "todo";
}

function buildLocalQueryBundle(
  primaryQuery: string,
  requestedSections: string[],
  targetTitle: string,
  exclusionIds: number[] = []
) {
  return {
    primary_query: primaryQuery.trim(),
    supporting_queries: [],
    exact_title_query: targetTitle || null,
    section_query:
      requestedSections.find((section) => SECTION_TO_QUERY[section]) &&
      SECTION_TO_QUERY[requestedSections.find((section) => SECTION_TO_QUERY[section])!],
    exclusion_ids: exclusionIds,
  };
}

function buildLocalTodoInput(args: {
  promptAnalysis: Record<string, unknown>;
  projectId?: string;
  selectedRunIds?: string[];
  todoId: string;
  title: string;
  phaseClass: "research" | "verification" | "synthesis";
  requiredClass:
    | "required_before_verification"
    | "optional_context"
    | "verification"
    | "synthesis";
  purpose: string;
  expectedOutput: string;
  completionCondition: string;
  origin?: "initial" | "replanned" | "verification_generated";
  query: string;
  targetTitle?: string;
  targetPaperId?: number;
  requestedSections?: string[];
  exclusionIds?: number[];
}) {
  const requestedSections = args.requestedSections ?? [];
  const exclusionIds = args.exclusionIds ?? [];
  return {
    payload_version: LOCAL_PAYLOAD_VERSION,
    planner_version: LOCAL_PLANNER_VERSION,
    todoId: args.todoId,
    todoTitle: args.title,
    phaseClass: args.phaseClass,
    requiredClass: args.requiredClass,
    origin: args.origin ?? "initial",
    purpose: args.purpose,
    expectedOutput: args.expectedOutput,
    completionCondition: args.completionCondition,
    projectId: args.projectId ?? "",
    selectedRunIds: args.selectedRunIds ?? [],
    promptAnalysis: args.promptAnalysis,
    normalizedQuery: buildLocalQueryBundle(
      args.query,
      requestedSections,
      args.targetTitle ?? "",
      exclusionIds
    ),
    query: args.query,
    targetTitle: args.targetTitle ?? undefined,
    targetPaperId: args.targetPaperId || undefined,
    requestedSections,
    exclusionIds,
    excludePaperIds: exclusionIds,
  };
}

function buildLocalTodo(
  position: number,
  config: {
    promptAnalysis: Record<string, unknown>;
    projectId?: string;
    selectedRunIds?: string[];
    title: string;
    description: string;
    toolName: string;
    phaseClass: "research" | "verification" | "synthesis";
    requiredClass:
      | "required_before_verification"
      | "optional_context"
      | "verification"
      | "synthesis";
    purpose: string;
    expectedOutput: string;
    completionCondition: string;
    query: string;
    targetTitle?: string;
    targetPaperId?: number;
    requestedSections?: string[];
    exclusionIds?: number[];
  }
) {
  return {
    position,
    title: config.title,
    description: config.description,
    tool_name: config.toolName,
    tool_input: buildLocalTodoInput({
      promptAnalysis: config.promptAnalysis,
      projectId: config.projectId,
      selectedRunIds: config.selectedRunIds,
      todoId: `initial-${position}-${slugifyTodo(config.title)}`,
      title: config.title,
      phaseClass: config.phaseClass,
      requiredClass: config.requiredClass,
      purpose: config.purpose,
      expectedOutput: config.expectedOutput,
      completionCondition: config.completionCondition,
      query: config.query,
      targetTitle: config.targetTitle,
      targetPaperId: config.targetPaperId,
      requestedSections: config.requestedSections,
      exclusionIds: config.exclusionIds,
    }),
  };
}

async function loadScopedPlanPapers(
  ownerUserId: string,
  folderId: string | "all" | undefined,
  projectId: string | undefined,
  selectedRunIds: string[] = []
): Promise<LocalPlanPaper[]> {
  const supabase = getSupabaseAdmin();
  const normalizedRunIds = await resolveScopedRunIds(supabase, ownerUserId, selectedRunIds);
  let query = supabase
    .from("papers_full")
    .select("paper_id,title,year,folder_id,ingestion_run_id")
    .eq("owner_user_id", ownerUserId);

  if (normalizedRunIds.length > 0) {
    query = query.in("ingestion_run_id", normalizedRunIds);
  } else if (folderId && folderId !== "all") {
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

async function resolveScopedRunIds(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  selectedRunIds: string[] = []
) {
  const normalizedRunIds = [...new Set(selectedRunIds.filter(Boolean))];
  if (normalizedRunIds.length === 0) {
    return normalizedRunIds;
  }

  const resolved = new Set(normalizedRunIds);
  let frontier = [...normalizedRunIds];

  for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
    const { data, error } = await supabase
      .from("ingestion_runs")
      .select("id,copied_from_run_id")
      .eq("owner_user_id", ownerUserId)
      .in("id", frontier);
    if (error) {
      throw new Error(error.message);
    }
    frontier = (data ?? [])
      .map((row) => String((row as { copied_from_run_id?: string | null }).copied_from_run_id ?? ""))
      .filter((runId) => Boolean(runId) && !resolved.has(runId));
    frontier.forEach((runId) => resolved.add(runId));
  }

  return [...resolved];
}

async function buildLocalResearchPlan(
  prompt: string,
  pendingRunCount: number,
  ownerUserId: string,
  folderId: string | "all" | undefined,
  projectId: string | undefined,
  selectedRunIds: string[] = []
) {
  const papers = await loadScopedPlanPapers(ownerUserId, folderId, projectId, selectedRunIds);
  const promptAnalysis = buildLocalPromptAnalysis(prompt, papers, selectedRunIds);
  const needsAnalysis = pendingRunCount > 0;
  const requestedSections = Array.isArray(promptAnalysis.requested_sections)
    ? promptAnalysis.requested_sections
    : [];
  const normalizedQuery = String(promptAnalysis.normalized_query || prompt).trim();
  const candidateTitle = String(promptAnalysis.candidate_title || "");
  const targetPaperId = Number(promptAnalysis.target_paper_id || 0);
  const steps: Array<{
    position: number;
    title: string;
    description: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
  }> = [];

  const addStep = (
    config: Omit<Parameters<typeof buildLocalTodo>[1], "promptAnalysis" | "projectId" | "selectedRunIds">
  ) => {
    steps.push(
      buildLocalTodo(steps.length + 1, {
        ...config,
        promptAnalysis,
        projectId,
        selectedRunIds,
      })
    );
  };

  let summary = `Research "${normalizedQuery}" inside the selected scope, verify coverage, and draft a grounded report.`;

  if (promptAnalysis.single_paper && promptAnalysis.candidate_title) {
    if (promptAnalysis.target_in_scope) {
      addStep({
        title: "Confirm the target paper in scope",
        description: `Confirm that "${candidateTitle}" is the correct in-scope anchor for the report.`,
        toolName: "list_folder_papers",
        phaseClass: "research",
        requiredClass: "required_before_verification",
        purpose: "Lock the named paper before extracting evidence.",
        expectedOutput: "A scope confirmation for the named paper.",
        completionCondition: "The named paper is confirmed or residual ambiguity is stated.",
        query: candidateTitle,
        targetTitle: candidateTitle,
        targetPaperId,
      });
      addStep({
        title: "Extract the requested sections",
        description: "Read the named paper directly and pull the sections needed for the requested report structure.",
        toolName: "read_paper_sections",
        phaseClass: "research",
        requiredClass: "required_before_verification",
        purpose: "Ground the answer in the exact paper first.",
        expectedOutput: "Section-level evidence from the named paper.",
        completionCondition: "The paper's relevant sections are extracted.",
        query: candidateTitle,
        targetTitle: candidateTitle,
        targetPaperId,
        requestedSections,
      });
      addStep({
        title: "Pull supporting context",
        description: "Retrieve adjacent in-scope papers only if they strengthen background, contrast, or implications.",
        toolName: "fetch_papers",
        phaseClass: "research",
        requiredClass: "optional_context",
        purpose: "Broaden context without losing the named paper as the anchor.",
        expectedOutput: "A shortlist of supporting papers.",
        completionCondition: "Supporting context is gathered or judged unnecessary.",
        query: normalizedQuery,
        targetTitle: candidateTitle,
        targetPaperId,
        exclusionIds: [targetPaperId],
      });
      addStep({
        title: "Read supporting evidence",
        description: "Inspect the strongest supporting papers for evidence the target paper alone does not fully cover.",
        toolName: "read_paper_sections",
        phaseClass: "research",
        requiredClass: "optional_context",
        purpose: "Collect broader support for background, comparison, or implications.",
        expectedOutput: "Supporting section evidence from adjacent papers.",
        completionCondition: "Supporting evidence is reviewed or marked unnecessary.",
        query: normalizedQuery,
        targetTitle: candidateTitle,
        targetPaperId,
        requestedSections,
        exclusionIds: [targetPaperId],
      });
      summary = `Read "${candidateTitle}" directly first, then widen only where supporting context strengthens the requested report.`;
    } else {
      addStep({
        title: "Verify scope coverage",
        description: `Check whether "${candidateTitle}" is actually present in the selected scope.`,
        toolName: "list_folder_papers",
        phaseClass: "research",
        requiredClass: "required_before_verification",
        purpose: "Validate whether the requested paper exists in the current scope.",
        expectedOutput: "A scope summary and any exact or probable matches.",
        completionCondition: "The scope confirms presence, ambiguity, or absence of the named paper.",
        query: candidateTitle,
        targetTitle: candidateTitle,
      });
      addStep({
        title: "Search for exact and probable matches",
        description: "Look for the nearest in-scope title matches so the report can explain the gap clearly.",
        toolName: "fetch_papers",
        phaseClass: "research",
        requiredClass: "required_before_verification",
        purpose: "Gather the strongest in-scope alternatives if the target paper is absent.",
        expectedOutput: "A ranked set of probable in-scope matches.",
        completionCondition: "Nearest matches are gathered or the scope gap is confirmed.",
        query: candidateTitle,
        targetTitle: candidateTitle,
      });
      summary = `Verify whether "${candidateTitle}" exists in the selected scope, capture the closest matches, and prepare a scope-gap report if it is absent.`;
    }
  } else if (promptAnalysis.compare) {
    addStep({
      title: "Retrieve comparison papers",
      description: "Find the strongest in-scope papers that match the requested comparison.",
      toolName: "fetch_papers",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Build the comparison set before drawing conclusions.",
      expectedOutput: "A focused comparison set of relevant papers.",
      completionCondition: "The comparison set is assembled or an evidence gap is recorded.",
      query: normalizedQuery,
    });
    addStep({
      title: "Read comparable sections",
      description: "Inspect methods, findings, and conclusions that support direct paper-to-paper comparison.",
      toolName: "read_paper_sections",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Extract direct evidence for the requested comparison dimensions.",
      expectedOutput: "Comparable section evidence across the retrieved papers.",
      completionCondition: "Comparison evidence is extracted from the strongest papers.",
      query: normalizedQuery,
      requestedSections,
    });
    addStep({
      title: "Check corpus framing",
      description: "Use workspace-level context only where it helps explain representativeness or coverage.",
      toolName: "get_dashboard_summary",
      phaseClass: "research",
      requiredClass: "optional_context",
      purpose: "Add light corpus framing without replacing document evidence.",
      expectedOutput: "A concise coverage note for the comparison set.",
      completionCondition: "Corpus framing is captured or judged unnecessary.",
      query: normalizedQuery,
    });
    summary = `Identify the strongest comparison papers for "${normalizedQuery}", extract comparable evidence, and verify whether the requested contrast is fully supported.`;
  } else if (promptAnalysis.survey || papers.length >= 8) {
    addStep({
      title: "Map the scoped corpus",
      description: "List the in-scope papers first so the review stays grounded in the current workspace.",
      toolName: "list_folder_papers",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Establish what evidence is actually available in the workspace.",
      expectedOutput: "A scope map of the currently available papers.",
      completionCondition: "The corpus scope is summarized.",
      query: normalizedQuery,
    });
    addStep({
      title: "Retrieve the strongest papers",
      description: "Pull the most relevant papers for the topic without echoing the full instruction prompt into retrieval.",
      toolName: "fetch_papers",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Build the core evidence base for the topic review.",
      expectedOutput: "A grounded shortlist of the strongest topic-relevant papers.",
      completionCondition: "The evidence base is retrieved or a scope gap is recorded.",
      query: normalizedQuery,
    });
    addStep({
      title: "Read the most relevant sections",
      description: "Inspect the sections that carry the evidence the user asked for.",
      toolName: "read_paper_sections",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Extract the evidence needed for the requested review.",
      expectedOutput: "Section-level evidence from the strongest papers.",
      completionCondition: "Relevant sections are extracted from the evidence base.",
      query: normalizedQuery,
      requestedSections,
    });
    addStep({
      title: "Frame coverage patterns",
      description: "Use workspace-level trends only when they improve chronology, coverage, or topic framing.",
      toolName: "get_dashboard_summary",
      phaseClass: "research",
      requiredClass: "optional_context",
      purpose: "Add high-level framing without replacing paper evidence.",
      expectedOutput: "A concise trend or coverage framing note.",
      completionCondition: "Coverage framing is captured or marked unnecessary.",
      query: normalizedQuery,
    });
    summary = `Map the scoped corpus for "${normalizedQuery}", retrieve the strongest papers, extract section evidence, and verify whether the review fully covers the request.`;
  } else {
    addStep({
      title: "Check scoped coverage",
      description: "Quickly verify the workspace coverage before drilling into the answer.",
      toolName: "list_folder_papers",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Understand the available scope before answering.",
      expectedOutput: "A concise scope snapshot for this request.",
      completionCondition: "Scope coverage is summarized.",
      query: normalizedQuery,
    });
    addStep({
      title: "Retrieve relevant papers",
      description: "Find the in-scope papers that most directly answer the request.",
      toolName: "fetch_papers",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Build the smallest grounded evidence set needed to answer the request.",
      expectedOutput: "A shortlist of directly relevant papers.",
      completionCondition: "Relevant papers are retrieved or the evidence gap is recorded.",
      query: normalizedQuery,
    });
    addStep({
      title: "Read the requested evidence",
      description: "Inspect the paper sections most likely to contain the answer instead of relying on broad analytics.",
      toolName: "read_paper_sections",
      phaseClass: "research",
      requiredClass: "required_before_verification",
      purpose: "Extract evidence for the exact sections or claims the user requested.",
      expectedOutput: "Section-level evidence from the most relevant papers.",
      completionCondition: "Requested evidence is extracted from the selected papers.",
      query: normalizedQuery,
      requestedSections,
    });
    summary = `Retrieve the most relevant in-scope papers for "${normalizedQuery}" and verify whether their sections fully support the requested answer.`;
  }

  addStep({
    title: "Verify coverage before synthesis",
    description: "Check target resolution, requested sections, citation coverage, and evidence-gap disclosure before drafting the report.",
    toolName: "verify_research",
    phaseClass: "verification",
    requiredClass: "verification",
    purpose: "Prevent synthesis from running on incomplete or misleading evidence.",
    expectedOutput: "A verification decision with approval, warnings, or follow-up work.",
    completionCondition: "Verification passes, passes with warnings, or generates follow-up work.",
    query: normalizedQuery,
    targetTitle: candidateTitle,
    targetPaperId,
    requestedSections,
  });
  addStep({
    title: "Draft the final report",
    description: "Synthesize the verified findings into a grounded prose report that never exposes raw tool output.",
    toolName: "synthesize_report",
    phaseClass: "synthesis",
    requiredClass: "synthesis",
    purpose: "Produce the final report only after verification has decided the evidence path.",
    expectedOutput: "A grounded prose report that reflects the completed evidence path.",
    completionCondition: "A valid full or partial report is produced.",
    query: normalizedQuery,
    targetTitle: candidateTitle,
    targetPaperId,
    requestedSections,
  });

  if (needsAnalysis) {
    summary = `Analyze the pending files first, then ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
  }

  return {
    title: buildThreadTitle(candidateTitle || normalizedQuery || prompt),
    summary,
    requires_analysis: needsAnalysis,
    pending_run_count: pendingRunCount,
    steps,
  };
}

async function countPendingRuns(
  folderId: string | "all" | undefined,
  projectId: string | undefined,
  ownerUserId: string,
  selectedRunIds: string[] = [],
) {
  const supabase = getSupabaseAdmin();
  const normalizedRunIds = selectedRunIds.filter(Boolean);
  let query = supabase
    .from("ingestion_runs")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", ownerUserId)
    .in("status", ["queued", "processing"]);

  if (normalizedRunIds.length > 0) {
    query = query.in("id", normalizedRunIds);
  } else if (folderId && folderId !== "all") {
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
  const reusableSessionId = await resolveReusableDeepResearchSessionId(
    supabase,
    ownerUserId,
    body
  );
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
      selectedRunIds: body.selectedRunIds ?? [],
      message: prompt,
    });
  } catch {
    rawPlan = null;
  }

  const pendingRunCount = await countPendingRuns(
    body.folderId,
    body.projectId,
    ownerUserId,
    body.selectedRunIds ?? []
  );
  const plan =
    rawPlan ??
    (await buildLocalResearchPlan(
      prompt,
      pendingRunCount,
      ownerUserId,
      body.folderId,
      body.projectId,
      body.selectedRunIds ?? []
    ));
  const session = await replaceDeepResearchPlan(supabase, {
    threadId: thread.id,
    ownerUserId,
    folderId: body.folderId,
    sessionId: reusableSessionId,
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
    ownerUserId,
    body.selectedRunIds ?? []
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
