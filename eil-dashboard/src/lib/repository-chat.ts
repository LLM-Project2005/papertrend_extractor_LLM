import { createHash } from "node:crypto";
import { z } from "zod";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { createChatCompletionResult } from "@/lib/openai";
import {
  buildRepositoryTermCounts,
  normalizeRepositoryText,
  tokenizeRepositoryText,
} from "@/lib/repository-text";
import { getDatabaseProvider } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type RepositoryIntent =
  | "general"
  | "repository_qa"
  | "word_count"
  | "topic_summary"
  | "topic_chart";

export interface RepositoryCitation {
  paperId: string;
  title: string;
  year: string;
  href: string;
  reason: string;
  sourceType: "paper";
}

export interface RepositoryChartPayload {
  chartType: "bar" | "line" | "pie" | "table";
  title: string;
  scopeLabel: string;
  metric: "word_count" | "top_topics" | "topic_trend";
  xKey: "label";
  yKeys: string[];
  data: Array<Record<string, string | number>>;
  planner: {
    source: "llm" | "fallback";
    reason: string;
    confidence: "high" | "medium" | "low";
    warnings: string[];
  };
}

interface RepositoryPaper {
  paperId: string;
  runId: string;
  folderId: string;
  title: string;
  year: string;
  abstract: string;
  methods: string;
  results: string;
  conclusion: string;
  content: string;
  contentHash: string;
  totalWords: number;
  termCounts: Record<string, number>;
  topics: Map<string, number>;
  keywords: Map<string, number>;
}

export interface RepositoryContext {
  ownerUserId: string;
  projectId: string;
  folderId: string | null;
  selectedRunIds: string[];
  scopeLabel: string;
  versionHash: string;
  summaryMarkdown: string;
  papers: RepositoryPaper[];
  topicCounts: Array<{ label: string; paperCount: number; mentions: number }>;
  keywordCounts: Array<{ label: string; paperCount: number; mentions: number }>;
  totalWords: number;
}

export interface RepositoryPromptPlan {
  intent: RepositoryIntent;
  refinedQuestion: string;
  terms: string[];
  retrievalQueries: string[];
  needsChart: boolean;
  chartType: "bar" | "line" | "pie" | "table";
  reason: string;
  confidence: "high" | "medium" | "low";
  source: "llm" | "fallback";
}

export interface RepositoryChatResult {
  handled: boolean;
  answer: string;
  citations: RepositoryCitation[];
  charts: RepositoryChartPayload[];
  plan: RepositoryPromptPlan;
  diagnostics: {
    projectId: string;
    folderId: string | null;
    selectedRunCount: number;
    paperCount: number;
    versionHash: string;
    scopeLabel: string;
  };
}

interface RepositoryChatInput {
  ownerUserId: string;
  projectId: string;
  folderId?: string | null;
  selectedRunIds?: string[];
  prompt: string;
  model?: string;
  forceChart?: boolean;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface PaperRow {
  paper_id: string | number;
  folder_id?: string | null;
  year?: string | null;
  title?: string | null;
  abstract?: string | null;
  abstract_claims?: string | null;
  methods?: string | null;
  results?: string | null;
  body?: string | null;
  raw_text?: string | null;
  conclusion?: string | null;
  ingestion_run_id?: string | null;
}

interface KeywordRow {
  paper_id: string | number;
  topic?: string | null;
  keyword?: string | null;
  keyword_frequency?: number | null;
}

interface TermIndexRow {
  paper_id: string | number;
  content_hash: string;
  total_words: number;
  term_counts: Record<string, number> | null;
}

const PromptPlanSchema = z.object({
  intent: z.enum([
    "general",
    "repository_qa",
    "word_count",
    "topic_summary",
    "topic_chart",
  ]),
  refinedQuestion: z.string().min(1).max(1000),
  terms: z.array(z.string().min(1).max(100)).max(8).default([]),
  retrievalQueries: z.array(z.string().min(1).max(240)).max(8).default([]),
  needsChart: z.boolean().default(false),
  chartType: z.enum(["bar", "line", "pie", "table"]).default("bar"),
  reason: z.string().max(500).default(""),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or", "paper", "papers", "repository", "the",
  "this", "to", "was", "were", "what", "when", "where", "which", "with",
]);
const TERM_INDEX_VERSION = "papertrend-term-index-v2";

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalPaperContent(row: PaperRow): string {
  const fullText = String(row.body ?? row.raw_text ?? "").trim();
  if (fullText) return fullText;
  return [row.abstract_claims, row.abstract, row.methods, row.results, row.conclusion]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizedIdList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 50);
}

function paperFromRow(row: PaperRow): RepositoryPaper {
  const content = canonicalPaperContent(row);
  const index = buildRepositoryTermCounts(content);
  return {
    paperId: String(row.paper_id),
    runId: String(row.ingestion_run_id ?? ""),
    folderId: String(row.folder_id ?? ""),
    title: String(row.title ?? "Untitled paper").trim() || "Untitled paper",
    year: String(row.year ?? "Unknown").trim() || "Unknown",
    abstract: String(row.abstract_claims ?? row.abstract ?? "").trim(),
    methods: String(row.methods ?? "").trim(),
    results: String(row.results ?? "").trim(),
    conclusion: String(row.conclusion ?? "").trim(),
    content,
    contentHash: hashText(`${TERM_INDEX_VERSION}\u0000${content}`),
    totalWords: index.totalWords,
    termCounts: index.termCounts,
    topics: new Map(),
    keywords: new Map(),
  };
}

function addKeywordRows(papers: RepositoryPaper[], rows: KeywordRow[]): void {
  const byId = new Map(papers.map((paper) => [paper.paperId, paper]));
  rows.forEach((row) => {
    const paper = byId.get(String(row.paper_id));
    if (!paper) return;
    const frequency = Math.max(Number(row.keyword_frequency ?? 1) || 1, 1);
    const topic = String(row.topic ?? "").trim();
    const keyword = String(row.keyword ?? "").trim();
    if (topic) paper.topics.set(topic, (paper.topics.get(topic) ?? 0) + frequency);
    if (keyword) paper.keywords.set(keyword, (paper.keywords.get(keyword) ?? 0) + frequency);
  });
}

function aggregateLabels(
  papers: RepositoryPaper[],
  key: "topics" | "keywords"
): Array<{ label: string; paperCount: number; mentions: number }> {
  const aggregate = new Map<string, { papers: Set<string>; mentions: number }>();
  papers.forEach((paper) => {
    paper[key].forEach((frequency, label) => {
      const current = aggregate.get(label) ?? { papers: new Set<string>(), mentions: 0 };
      current.papers.add(paper.paperId);
      current.mentions += frequency;
      aggregate.set(label, current);
    });
  });
  return [...aggregate.entries()]
    .map(([label, value]) => ({
      label,
      paperCount: value.papers.size,
      mentions: value.mentions,
    }))
    .sort(
      (left, right) =>
        right.paperCount - left.paperCount ||
        right.mentions - left.mentions ||
        left.label.localeCompare(right.label)
    );
}

async function loadSupabaseRows(input: RepositoryChatInput): Promise<{
  papers: PaperRow[];
  keywords: KeywordRow[];
  scopeLabel: string;
}> {
  const supabase = getSupabaseAdmin();
  const { data: project, error: projectError } = await supabase
    .from("workspace_projects")
    .select("id,name")
    .eq("id", input.projectId)
    .eq("owner_user_id", input.ownerUserId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) throw new Error("Project not found.");

  let folderQuery = supabase
    .from("research_folders")
    .select("id,name")
    .eq("owner_user_id", input.ownerUserId)
    .eq("project_id", input.projectId);
  if (input.folderId && input.folderId !== "all") {
    folderQuery = folderQuery.eq("id", input.folderId);
  }
  const { data: folders, error: foldersError } = await folderQuery;
  if (foldersError) throw new Error(foldersError.message);
  const folderIds = (folders ?? []).map((folder) => String(folder.id));
  if (input.folderId && input.folderId !== "all" && folderIds.length === 0) {
    throw new Error("Folder not found in this project.");
  }
  if (folderIds.length === 0) {
    return { papers: [], keywords: [], scopeLabel: String(project.name ?? "Project") };
  }

  let runQuery = supabase
    .from("ingestion_runs")
    .select("id,folder_id")
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", "succeeded")
    .is("trashed_at", null)
    .in("folder_id", folderIds);
  const selectedRunIds = normalizedIdList(input.selectedRunIds);
  if (selectedRunIds.length > 0) runQuery = runQuery.in("id", selectedRunIds);
  const { data: runs, error: runsError } = await runQuery;
  if (runsError) throw new Error(runsError.message);
  const runIds = (runs ?? []).map((run) => String(run.id));
  if (runIds.length === 0) {
    const selectedFolder = (folders ?? [])[0];
    return {
      papers: [],
      keywords: [],
      scopeLabel: selectedRunIds.length > 0
        ? "selected papers"
        : String(selectedFolder?.name ?? project.name ?? "Repository"),
    };
  }

  const { data: paperRows, error: papersError } = await supabase
    .from("papers_full")
    .select("*")
    .eq("owner_user_id", input.ownerUserId)
    .in("ingestion_run_id", runIds);
  if (papersError) throw new Error(papersError.message);
  const paperIds = (paperRows ?? []).map((paper) => String(paper.paper_id));
  const keywords = paperIds.length > 0
    ? await supabase
        .from("paper_keywords")
        .select("paper_id,topic,keyword,keyword_frequency")
        .eq("owner_user_id", input.ownerUserId)
        .in("paper_id", paperIds)
    : { data: [], error: null };
  if (keywords.error) throw new Error(keywords.error.message);

  const selectedFolder = input.folderId && input.folderId !== "all" ? (folders ?? [])[0] : null;
  return {
    papers: (paperRows ?? []) as PaperRow[],
    keywords: (keywords.data ?? []) as KeywordRow[],
    scopeLabel: selectedRunIds.length > 0
      ? `${runIds.length} selected paper${runIds.length === 1 ? "" : "s"}`
      : selectedFolder
        ? String(selectedFolder.name)
        : `${String(project.name ?? "Project")} repository`,
  };
}

async function loadCloudSqlRows(input: RepositoryChatInput): Promise<{
  papers: PaperRow[];
  keywords: KeywordRow[];
  scopeLabel: string;
}> {
  return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
    const project = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM public.workspace_projects WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
      [input.projectId, input.ownerUserId]
    );
    if (!project.rows[0]) throw new Error("Project not found.");

    const values: unknown[] = [input.ownerUserId, input.projectId];
    const conditions = ["ir.owner_user_id = $1", "rf.project_id = $2", "ir.status = 'succeeded'", "ir.trashed_at IS NULL"];
    if (input.folderId && input.folderId !== "all") {
      values.push(input.folderId);
      conditions.push(`rf.id = $${values.length}`);
    }
    const selectedRunIds = normalizedIdList(input.selectedRunIds);
    if (selectedRunIds.length > 0) {
      values.push(selectedRunIds);
      conditions.push(`ir.id = ANY($${values.length}::uuid[])`);
    }

    const paperResult = await client.query<PaperRow>(
      `
        SELECT
          p.id::text AS paper_id,
          p.folder_id,
          p.year,
          p.title,
          pc.abstract,
          COALESCE(pc.abstract_claims, pc.abstract) AS abstract_claims,
          pc.methods,
          pc.results,
          pc.body,
          pc.raw_text,
          pc.conclusion,
          pc.ingestion_run_id
        FROM public.papers p
        JOIN public.paper_content pc ON pc.paper_id = p.id
        JOIN public.ingestion_runs ir ON ir.id = pc.ingestion_run_id
        JOIN public.research_folders rf ON rf.id = ir.folder_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY p.title ASC
      `,
      values
    );
    const paperIds = paperResult.rows.map((paper) => String(paper.paper_id));
    const keywordResult = paperIds.length > 0
      ? await client.query<KeywordRow>(
          `
            SELECT paper_id::text, topic, keyword, keyword_frequency
            FROM public.paper_keywords
            WHERE owner_user_id = $1 AND paper_id = ANY($2::bigint[])
          `,
          [input.ownerUserId, paperIds]
        )
      : { rows: [] as KeywordRow[] };

    let scopeLabel = `${project.rows[0].name} repository`;
    if (selectedRunIds.length > 0) {
      scopeLabel = `${paperResult.rows.length} selected paper${paperResult.rows.length === 1 ? "" : "s"}`;
    } else if (input.folderId && input.folderId !== "all") {
      const folder = await client.query<{ name: string }>(
        `SELECT name FROM public.research_folders WHERE id = $1 AND owner_user_id = $2 AND project_id = $3 LIMIT 1`,
        [input.folderId, input.ownerUserId, input.projectId]
      );
      if (!folder.rows[0]) throw new Error("Folder not found in this project.");
      scopeLabel = folder.rows[0].name;
    }
    return { papers: paperResult.rows, keywords: keywordResult.rows, scopeLabel };
  });
}

async function loadTermIndexes(
  ownerUserId: string,
  paperIds: string[]
): Promise<Map<string, TermIndexRow>> {
  if (paperIds.length === 0) return new Map();
  try {
    if (getDatabaseProvider() === "cloud-sql") {
      return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
        const result = await client.query<TermIndexRow>(
          `SELECT paper_id::text, content_hash, total_words, term_counts FROM public.paper_term_index WHERE owner_user_id = $1 AND paper_id = ANY($2::bigint[])`,
          [ownerUserId, paperIds]
        );
        return new Map(result.rows.map((row) => [String(row.paper_id), row]));
      });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("paper_term_index")
      .select("paper_id,content_hash,total_words,term_counts")
      .eq("owner_user_id", ownerUserId)
      .in("paper_id", paperIds);
    if (error) return new Map();
    return new Map(((data ?? []) as TermIndexRow[]).map((row) => [String(row.paper_id), row]));
  } catch {
    return new Map();
  }
}

async function saveTermIndexes(ownerUserId: string, papers: RepositoryPaper[]): Promise<void> {
  if (papers.length === 0) return;
  try {
    if (getDatabaseProvider() === "cloud-sql") {
      await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
        for (const paper of papers) {
          await client.query(
            `
              INSERT INTO public.paper_term_index (
                paper_id, owner_user_id, folder_id, ingestion_run_id,
                content_hash, total_words, term_counts, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
              ON CONFLICT (paper_id) DO UPDATE SET
                owner_user_id = EXCLUDED.owner_user_id,
                folder_id = EXCLUDED.folder_id,
                ingestion_run_id = EXCLUDED.ingestion_run_id,
                content_hash = EXCLUDED.content_hash,
                total_words = EXCLUDED.total_words,
                term_counts = EXCLUDED.term_counts,
                updated_at = now()
            `,
            [
              paper.paperId,
              ownerUserId,
              paper.folderId || null,
              paper.runId || null,
              paper.contentHash,
              paper.totalWords,
              JSON.stringify(paper.termCounts),
            ]
          );
        }
      });
      return;
    }
    const supabase = getSupabaseAdmin();
    await supabase.from("paper_term_index").upsert(
      papers.map((paper) => ({
        paper_id: paper.paperId,
        owner_user_id: ownerUserId,
        folder_id: paper.folderId || null,
        ingestion_run_id: paper.runId || null,
        content_hash: paper.contentHash,
        total_words: paper.totalWords,
        term_counts: paper.termCounts,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "paper_id" }
    );
  } catch {
    // The feature remains correct without a warm cache when a migration has
    // not reached an environment yet. The next request can rebuild it.
  }
}

function applyCachedIndexes(papers: RepositoryPaper[], cached: Map<string, TermIndexRow>): RepositoryPaper[] {
  const stale: RepositoryPaper[] = [];
  papers.forEach((paper) => {
    const item = cached.get(paper.paperId);
    if (item?.content_hash === paper.contentHash && item.term_counts) {
      paper.termCounts = item.term_counts;
      paper.totalWords = Number(item.total_words ?? 0);
    } else {
      stale.push(paper);
    }
  });
  return stale;
}

function buildRepositorySummary(
  scopeLabel: string,
  papers: RepositoryPaper[],
  topics: RepositoryContext["topicCounts"],
  totalWords: number
): string {
  const lines = [
    "# Repository context",
    "",
    `Scope: ${scopeLabel}`,
    `Analyzed papers: ${papers.length}`,
    `Indexed words: ${totalWords}`,
    "",
    "## Papers",
    ...papers.map((paper) => {
      const labels = [...paper.topics.keys()].slice(0, 4).join(", ");
      return `- [Paper ${paper.paperId}] ${paper.title} (${paper.year})${labels ? ` - ${labels}` : ""}`;
    }),
  ];
  if (topics.length > 0) {
    lines.push(
      "",
      "## Leading topics",
      ...topics.slice(0, 12).map((topic) => `- ${topic.label}: ${topic.paperCount} paper(s), ${topic.mentions} analyzed mentions`)
    );
  }
  return lines.join("\n");
}

async function saveRepositoryCache(context: RepositoryContext): Promise<void> {
  const scopeKey = `repository:v1:${context.projectId}:${context.folderId ?? "all"}:${
    context.selectedRunIds.length > 0 ? hashText(context.selectedRunIds.join(",")).slice(0, 16) : "scope"
  }`;
  const payload = {
    kind: "repository_context_v1",
    projectId: context.projectId,
    folderId: context.folderId,
    selectedRunIds: context.selectedRunIds,
    paperCount: context.papers.length,
    totalWords: context.totalWords,
    summaryMarkdown: context.summaryMarkdown,
    topics: context.topicCounts.slice(0, 30),
    keywords: context.keywordCounts.slice(0, 50),
    manifest: context.papers.map((paper) => ({
      paperId: paper.paperId,
      runId: paper.runId,
      title: paper.title,
      year: paper.year,
      contentHash: paper.contentHash,
    })),
  };
  try {
    if (getDatabaseProvider() === "cloud-sql") {
      await withCloudSqlOwnerTransaction(context.ownerUserId, async (client) => {
        await client.query(
          `
            INSERT INTO public.workspace_analytics_cache (
              owner_user_id, scope_type, scope_key, version_hash, payload, updated_at
            ) VALUES ($1, 'custom', $2, $3, $4::jsonb, now())
            ON CONFLICT (owner_user_id, scope_type, scope_key) DO UPDATE SET
              version_hash = EXCLUDED.version_hash,
              payload = EXCLUDED.payload,
              updated_at = now()
          `,
          [context.ownerUserId, scopeKey, context.versionHash, JSON.stringify(payload)]
        );
      });
      return;
    }
    const supabase = getSupabaseAdmin();
    await supabase.from("workspace_analytics_cache").upsert(
      {
        owner_user_id: context.ownerUserId,
        scope_type: "custom",
        scope_key: scopeKey,
        version_hash: context.versionHash,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id,scope_type,scope_key" }
    );
  } catch {
    // This cache is an optimization, never a prerequisite for an answer.
  }
}

export async function loadRepositoryContext(input: RepositoryChatInput): Promise<RepositoryContext> {
  const selectedRunIds = normalizedIdList(input.selectedRunIds);
  const loaded = getDatabaseProvider() === "cloud-sql"
    ? await loadCloudSqlRows(input)
    : await loadSupabaseRows(input);
  const papers = loaded.papers.map(paperFromRow);
  addKeywordRows(papers, loaded.keywords);
  const cached = await loadTermIndexes(input.ownerUserId, papers.map((paper) => paper.paperId));
  const stale = applyCachedIndexes(papers, cached);
  await saveTermIndexes(input.ownerUserId, stale);

  const topicCounts = aggregateLabels(papers, "topics");
  const keywordCounts = aggregateLabels(papers, "keywords");
  const totalWords = papers.reduce((sum, paper) => sum + paper.totalWords, 0);
  const versionHash = hashText(
    papers
      .map((paper) => `${paper.paperId}:${paper.contentHash}`)
      .sort()
      .join("|")
  );
  const context: RepositoryContext = {
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    folderId: input.folderId && input.folderId !== "all" ? input.folderId : null,
    selectedRunIds,
    scopeLabel: loaded.scopeLabel,
    versionHash,
    summaryMarkdown: buildRepositorySummary(loaded.scopeLabel, papers, topicCounts, totalWords),
    papers,
    topicCounts,
    keywordCounts,
    totalWords,
  };
  await saveRepositoryCache(context);
  return context;
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const cleaned = value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function quotedTerms(prompt: string): string[] {
  return [...prompt.matchAll(/["“”']([^"“”']{1,100})["“”']/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 8);
}

function fallbackPromptPlan(prompt: string, forceChart: boolean): RepositoryPromptPlan {
  const lower = prompt.toLowerCase();
  const countIntent = /\b(count|frequency|frequencies|occurrence|occurrences|how many times)\b|นับ|จำนวนครั้ง/i.test(prompt);
  const topicIntent = /\b(topic|topics|theme|themes|concept|concepts|summari[sz]e)\b|หัวข้อ|ประเด็น|สรุป/i.test(prompt);
  const chartIntent = forceChart || /\b(chart|graph|plot|visuali[sz]e|bar|line)\b|กราฟ|แผนภูมิ/i.test(prompt);
  let terms = quotedTerms(prompt);
  if (countIntent && terms.length === 0) {
    const match = lower.match(/(?:count|frequency of|occurrences? of)\s+(?:the\s+)?(?:word\s+)?([\p{L}\p{N}'-]{2,64})/iu);
    if (match?.[1]) terms = [match[1]];
  }
  const intent: RepositoryIntent = countIntent
    ? "word_count"
    : topicIntent && chartIntent
      ? "topic_chart"
      : topicIntent
        ? "topic_summary"
        : "repository_qa";
  return {
    intent,
    refinedQuestion: prompt.trim(),
    terms,
    retrievalQueries: [prompt.trim()],
    needsChart: chartIntent,
    chartType: /\bline\b|กราฟเส้น/i.test(prompt) ? "line" : /\btable\b|ตาราง/i.test(prompt) ? "table" : "bar",
    reason: "Used the deterministic fallback because structured intent planning was unavailable.",
    confidence: "low",
    source: "fallback",
  };
}

export async function refineRepositoryPrompt(
  prompt: string,
  context: RepositoryContext,
  model?: string,
  forceChart = false
): Promise<RepositoryPromptPlan> {
  const fallback = fallbackPromptPlan(prompt, forceChart);
  try {
    const completion = await createChatCompletionResult(
      [
        {
          role: "system",
          content:
            "You are Papertrend's repository request director. Infer intent semantically, not through a fixed keyword taxonomy. " +
            "Return one JSON object only. Use general only when the request does not need the selected research repository. " +
            "Use word_count for exact word or phrase occurrence calculations. Use topic_summary or topic_chart for corpus topic analysis. " +
            "Use repository_qa for questions, comparisons, synthesis, methods, findings, and summaries grounded in papers. " +
            "Do not answer the question and do not invent paper data. Preserve exact requested terms in terms. " +
            "Schema: {intent, refinedQuestion, terms, retrievalQueries, needsChart, chartType, reason, confidence}.",
        },
        {
          role: "user",
          content: JSON.stringify({
            request: prompt,
            forceChart,
            scope: context.scopeLabel,
            paperCount: context.papers.length,
            papers: context.papers.slice(0, 30).map((paper) => ({
              id: paper.paperId,
              title: paper.title,
              year: paper.year,
              topics: [...paper.topics.keys()].slice(0, 6),
            })),
          }),
        },
      ],
      0.1,
      model,
      "CHAT_INTENT",
      { maxTokens: 700 }
    );
    const parsed = PromptPlanSchema.safeParse(extractJsonObject(completion?.content ?? ""));
    if (!parsed.success) return fallback;
    return {
      ...parsed.data,
      terms: [...new Set(parsed.data.terms.map((term) => term.trim()).filter(Boolean))],
      needsChart: forceChart || parsed.data.needsChart,
      source: "llm",
    };
  } catch {
    return fallback;
  }
}

export function countTermInRepositoryPaper(paper: RepositoryPaper, term: string): number {
  const tokens = tokenizeRepositoryText(term);
  if (tokens.length === 0) return 0;
  if (tokens.length === 1) return paper.termCounts[tokens[0]] ?? 0;
  const contentTokens = tokenizeRepositoryText(paper.content);
  let count = 0;
  for (let index = 0; index <= contentTokens.length - tokens.length; index += 1) {
    if (tokens.every((token, offset) => contentTokens[index + offset] === token)) count += 1;
  }
  return count;
}

function citationForPaper(paper: RepositoryPaper, reason: string): RepositoryCitation {
  return {
    paperId: paper.paperId,
    title: paper.title,
    year: paper.year,
    href: `/workspace/papers?paperId=${encodeURIComponent(paper.paperId)}`,
    reason,
    sourceType: "paper",
  };
}

function shortLabel(value: string, max = 54): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function wordCountResult(
  context: RepositoryContext,
  plan: RepositoryPromptPlan
): Pick<RepositoryChatResult, "answer" | "citations" | "charts"> {
  if (plan.terms.length === 0) {
    return {
      answer: "Which exact word or phrase should I count? Put it in quotation marks so I can preserve it exactly.",
      citations: [],
      charts: [],
    };
  }
  const terms = plan.terms.slice(0, 6);
  const rows = context.papers.map((paper) => {
    const values = Object.fromEntries(terms.map((term) => [term, countTermInRepositoryPaper(paper, term)]));
    return { paper, values };
  });
  const totals = Object.fromEntries(
    terms.map((term) => [term, rows.reduce((sum, row) => sum + Number(row.values[term] ?? 0), 0)])
  );
  const header = `| Paper | ${terms.join(" | ")} |`;
  const divider = `| --- | ${terms.map(() => "---:").join(" | ")} |`;
  const tableRows = rows.map(
    ({ paper, values }) =>
      `| [Paper ${paper.paperId}] ${paper.title.replace(/\|/g, "-")} | ${terms.map((term) => values[term]).join(" | ")} |`
  );
  const totalRow = `| **Total (${context.papers.length} papers)** | ${terms.map((term) => `**${totals[term]}**`).join(" | ")} |`;
  const answer = [
    `## Exact word count`,
    `Counted normalized, case-insensitive whole-word occurrences across **${context.scopeLabel}**.`,
    "",
    header,
    divider,
    ...tableRows,
    totalRow,
    "",
    "Counting is case-insensitive. Hyphens act as word boundaries, apostrophe-containing words are preserved, and multi-word terms require an exact consecutive phrase.",
  ].join("\n");
  const charts: RepositoryChartPayload[] = plan.needsChart
    ? [
        {
          chartType: plan.chartType === "line" ? "bar" : plan.chartType,
          title: `${terms.join(", ")} occurrences by paper`,
          scopeLabel: context.scopeLabel,
          metric: "word_count",
          xKey: "label",
          yKeys: terms,
          data: rows.map(({ paper, values }) => ({ label: shortLabel(paper.title), ...values })),
          planner: {
            source: plan.source,
            reason: plan.reason || "Exact term counts grouped by paper.",
            confidence: "high",
            warnings: [],
          },
        },
      ]
    : [];
  return {
    answer,
    citations: rows.map(({ paper }) => citationForPaper(paper, `Included in exact count for ${terms.join(", ")}.`)),
    charts,
  };
}

function topicResult(
  context: RepositoryContext,
  plan: RepositoryPromptPlan
): Pick<RepositoryChatResult, "answer" | "citations" | "charts"> {
  const topics = context.topicCounts.slice(0, 12);
  if (topics.length === 0) {
    return {
      answer: `I found ${context.papers.length} analyzed paper(s), but no topic rows are available in ${context.scopeLabel} yet. Reanalyze papers whose keyword/topic stage failed.`,
      citations: [],
      charts: [],
    };
  }
  const answer = [
    "## Repository topics",
    `Across **${context.scopeLabel}**, the strongest analyzed topic coverage is:`,
    "",
    ...topics.slice(0, 8).map(
      (topic, index) => `${index + 1}. **${topic.label}** - ${topic.paperCount} paper(s), ${topic.mentions} analyzed mentions`
    ),
    "",
    "Paper count shows corpus coverage; analyzed mentions reflects keyword frequency. Read both together so one repetitive paper does not look like broad repository coverage.",
  ].join("\n");
  const charts: RepositoryChartPayload[] = [];
  if (plan.needsChart || plan.intent === "topic_chart") {
    if (plan.chartType === "line") {
      const selectedTopics = topics.slice(0, 5).map((topic) => topic.label);
      const years = [...new Set(context.papers.map((paper) => paper.year))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      charts.push({
        chartType: "line",
        title: "Repository topic coverage by year",
        scopeLabel: context.scopeLabel,
        metric: "topic_trend",
        xKey: "label",
        yKeys: selectedTopics,
        data: years.map((year) => ({
          label: year,
          ...Object.fromEntries(
            selectedTopics.map((topic) => [
              topic,
              context.papers.filter((paper) => paper.year === year && paper.topics.has(topic)).length,
            ])
          ),
        })),
        planner: {
          source: plan.source,
          reason: plan.reason || "Compared top topic coverage across publication years.",
          confidence: "high",
          warnings: years.includes("Unknown") ? ["Unknown publication years are shown as a separate point."] : [],
        },
      });
    } else {
      charts.push({
        chartType: plan.chartType,
        title: "Top repository topics",
        scopeLabel: context.scopeLabel,
        metric: "top_topics",
        xKey: "label",
        yKeys: ["papers", "mentions"],
        data: topics.slice(0, 10).map((topic) => ({
          label: topic.label,
          papers: topic.paperCount,
          mentions: topic.mentions,
        })),
        planner: {
          source: plan.source,
          reason: plan.reason || "Compared topic breadth and analyzed frequency.",
          confidence: "high",
          warnings: [],
        },
      });
    }
  }
  const leadingLabels = new Set(topics.slice(0, 8).map((topic) => topic.label));
  const citedPapers = context.papers.filter((paper) => [...paper.topics.keys()].some((topic) => leadingLabels.has(topic)));
  return {
    answer,
    citations: citedPapers.map((paper) => citationForPaper(paper, `Contributes to the repository topic distribution.`)),
    charts,
  };
}

function retrievalTokens(plan: RepositoryPromptPlan): string[] {
  return [...new Set(
    tokenizeRepositoryText([plan.refinedQuestion, ...plan.retrievalQueries].join(" "))
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  )].slice(0, 24);
}

function bestPaperExcerpt(paper: RepositoryPaper, tokens: string[]): { score: number; excerpt: string } {
  const compactSections = [paper.abstract, paper.methods, paper.results, paper.conclusion].filter(Boolean);
  const paragraphs = [
    ...compactSections,
    ...paper.content.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).filter((part) => part.length >= 80),
  ].slice(0, 240);
  let best = { score: 0, excerpt: paper.abstract || paper.content.slice(0, 900) };
  paragraphs.forEach((paragraph) => {
    const normalized = normalizeRepositoryText(paragraph);
    const score = tokens.reduce((sum, token) => sum + (normalized.includes(token) ? 1 : 0), 0);
    if (score > best.score) best = { score, excerpt: paragraph.slice(0, 1200) };
  });
  const titleScore = tokens.reduce((sum, token) => sum + (normalizeRepositoryText(paper.title).includes(token) ? 4 : 0), 0);
  const topicScore = tokens.reduce(
    (sum, token) => sum + ([...paper.topics.keys(), ...paper.keywords.keys()].some((label) => normalizeRepositoryText(label).includes(token)) ? 3 : 0),
    0
  );
  return { score: best.score + titleScore + topicScore, excerpt: best.excerpt };
}

function buildEvidenceContext(context: RepositoryContext, plan: RepositoryPromptPlan): {
  text: string;
  papers: RepositoryPaper[];
} {
  const tokens = retrievalTokens(plan);
  const ranked = context.papers
    .map((paper) => ({ paper, ...bestPaperExcerpt(paper, tokens) }))
    .sort((left, right) => right.score - left.score || left.paper.title.localeCompare(right.paper.title));
  const selected = ranked.slice(0, Math.min(Math.max(context.papers.length, 1), 10));
  const text = selected
    .map(({ paper, excerpt }) => [
      `[Paper ${paper.paperId}] ${paper.title} (${paper.year})`,
      `Topics: ${[...paper.topics.keys()].slice(0, 8).join(", ") || "Not available"}`,
      `Evidence excerpt: ${excerpt || "No extracted excerpt available."}`,
    ].join("\n"))
    .join("\n\n");
  return { text: text.slice(0, 18_000), papers: selected.map((item) => item.paper) };
}

async function repositoryQaResult(
  input: RepositoryChatInput,
  context: RepositoryContext,
  plan: RepositoryPromptPlan
): Promise<Pick<RepositoryChatResult, "answer" | "citations" | "charts">> {
  const evidence = buildEvidenceContext(context, plan);
  const citations = evidence.papers.map((paper) => citationForPaper(paper, "Retrieved as relevant repository evidence."));
  const history = (input.history ?? []).slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 1200),
  }));
  try {
    const completion = await createChatCompletionResult(
      [
        {
          role: "system",
          content:
            "You are Papertrend's repository research assistant. Answer the refined question using only the supplied repository evidence. " +
            "Cite substantive paper-backed claims inline as [Paper <id>]. Distinguish findings from your interpretation. " +
            "If evidence is incomplete, say so clearly. Never invent counts, papers, methods, findings, or citations. " +
            "The repository brief is navigation context, while evidence excerpts are the source material.",
        },
        ...history,
        {
          role: "user",
          content: [
            `Original request: ${input.prompt}`,
            `Refined request: ${plan.refinedQuestion}`,
            "",
            context.summaryMarkdown,
            "",
            "# Retrieved evidence",
            evidence.text,
          ].join("\n"),
        },
      ],
      0.25,
      input.model,
      "CHAT_SYNTHESIS",
      { maxTokens: 1500 }
    );
    const answer = completion?.content?.trim();
    if (answer) return { answer, citations, charts: [] };
  } catch {
    // Fall through to a grounded deterministic response.
  }
  return {
    answer: [
      `I found ${context.papers.length} analyzed paper(s) in ${context.scopeLabel}.`,
      "",
      ...evidence.papers.slice(0, 6).map((paper) =>
        `- [Paper ${paper.paperId}] **${paper.title}** (${paper.year})${paper.abstract ? `: ${paper.abstract.slice(0, 260)}` : ""}`
      ),
    ].join("\n"),
    citations,
    charts: [],
  };
}

export async function runRepositoryChat(input: RepositoryChatInput): Promise<RepositoryChatResult> {
  const context = await loadRepositoryContext(input);
  const plan = await refineRepositoryPrompt(input.prompt, context, input.model, input.forceChart);
  const diagnostics = {
    projectId: context.projectId,
    folderId: context.folderId,
    selectedRunCount: context.selectedRunIds.length,
    paperCount: context.papers.length,
    versionHash: context.versionHash,
    scopeLabel: context.scopeLabel,
  };
  if (plan.intent === "general") {
    return { handled: false, answer: "", citations: [], charts: [], plan, diagnostics };
  }
  if (input.forceChart && plan.intent === "repository_qa") {
    return { handled: false, answer: "", citations: [], charts: [], plan, diagnostics };
  }
  if (context.papers.length === 0) {
    return {
      handled: true,
      answer: `No completed, analyzed papers were found in ${context.scopeLabel}. Upload or finish analyzing a paper, then try again.`,
      citations: [],
      charts: [],
      plan,
      diagnostics,
    };
  }
  const result = plan.intent === "word_count"
    ? wordCountResult(context, plan)
    : plan.intent === "topic_summary" || plan.intent === "topic_chart"
      ? topicResult(context, plan)
      : await repositoryQaResult(input, context, plan);
  return { handled: true, ...result, plan, diagnostics };
}
