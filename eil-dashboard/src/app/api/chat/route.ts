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
import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import {
  loadDashboardDataServer,
  loadScopedDashboardData,
} from "@/lib/dashboard-data-server";
import { createChatCompletionResult } from "@/lib/openai";
import { callPythonNodeService } from "@/lib/python-node-service";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerResearchQueue, triggerWorkerQueue } from "@/lib/worker-trigger";
import type { DashboardData, TrackRow } from "@/types/database";
import type {
  ChatThreadDetail,
  DeepResearchSessionRecord,
} from "@/types/research";
interface Citation {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason: string;
  sourceType?: "paper" | "web";
}

type ChatToolMode = "auto" | "web_search" | "chart" | "none";
type ChartScope = "selected_files" | "workspace";
type ChartType = "auto" | "bar" | "line" | "pie" | "table";
type ChartMetric =
  | "papers_per_year"
  | "top_topics"
  | "top_keywords"
  | "track_distribution"
  | "topic_trend"
  | "keyword_trend"
  | "track_trend";
type ChartGroupBy = "year" | "topic" | "keyword" | "track";

interface ChartRequest {
  scope?: ChartScope;
  chartType?: ChartType;
  metric?: ChartMetric;
  groupBy?: ChartGroupBy;
  topN?: number;
}

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

type ResolvedChartPlan = Required<ChartRequest> & {
  source: "llm" | "fallback";
  focusTerms: string[];
  title?: string;
  reason?: string;
  confidence?: "high" | "medium" | "low";
  warnings?: string[];
};

interface ChatToolResult {
  type: "web_search" | "chart";
  status: "succeeded" | "failed" | "skipped";
  data?: unknown;
  citations?: Citation[];
  error?: string;
}

interface ChatGenerationOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
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
  generationParameters?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  selectedYears?: string[];
  selectedTracks?: string[];
  searchQuery?: string;
  queryLanguage?: string;
  selectedRunIds?: string[];
  threadId?: string;
  folderId?: string | "all";
  projectId?: string;
  toolMode?: ChatToolMode;
  chartRequest?: ChartRequest;
  webSearchEnabled?: boolean;
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

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveGenerationOptions(body: ChatRequestBody): ChatGenerationOptions {
  const params =
    body.generationParameters && typeof body.generationParameters === "object"
      ? body.generationParameters
      : {};

  const temperature = toFiniteNumber(params.temperature);
  const topP = toFiniteNumber(params.topP);
  const topK = toFiniteNumber(params.topK);
  const maxTokens = toFiniteNumber(params.maxTokens);
  const frequencyPenalty = toFiniteNumber(params.frequencyPenalty);
  const presencePenalty = toFiniteNumber(params.presencePenalty);

  const options: ChatGenerationOptions = {};
  if (temperature !== undefined) {
    options.temperature = clampValue(temperature, 0, 2);
  }
  if (topP !== undefined) {
    options.topP = clampValue(topP, 0, 1);
  }
  if (topK !== undefined) {
    options.topK = Math.round(clampValue(topK, 0, 200));
  }
  if (maxTokens !== undefined) {
    options.maxTokens = Math.round(clampValue(maxTokens, 64, 8192));
  }
  if (frequencyPenalty !== undefined) {
    options.frequencyPenalty = clampValue(frequencyPenalty, -2, 2);
  }
  if (presencePenalty !== undefined) {
    options.presencePenalty = clampValue(presencePenalty, -2, 2);
  }
  return options;
}

const DEFAULT_CHAT_MODEL = "google/gemini-3.1-flash-lite";
const TOOL_CAPABLE_CHAT_MODELS = [
  "google/gemini-3.1-flash-lite",
  "google/gemma-4-31b-it",
  "openai/gpt-4.1-mini",
  "openai/gpt-4o-mini",
] as const;

const WEB_SEARCH_INTENT_PATTERN =
  /\b(web search|search the web|internet|online|latest|recent|today|news)\b|ค้นหาเว็บ|เว็บ|ล่าสุด|ข่าว/i;

function resolveChatModel(model?: string | null) {
  const normalized = String(model ?? "").trim();
  return TOOL_CAPABLE_CHAT_MODELS.includes(
    normalized as (typeof TOOL_CAPABLE_CHAT_MODELS)[number]
  )
    ? normalized
    : DEFAULT_CHAT_MODEL;
}

function hasWebSearchIntent(message: string) {
  return WEB_SEARCH_INTENT_PATTERN.test(message);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined) {
    return fallback;
  }
  return Math.round(clampValue(parsed, min, max));
}

function groupByForMetric(metric: ChartMetric): ChartGroupBy {
  if (metric === "top_topics" || metric === "topic_trend") return "topic";
  if (metric === "top_keywords" || metric === "keyword_trend") return "keyword";
  if (metric === "track_distribution") return "track";
  return "year";
}

function normalizeMetric(value: unknown): ChartMetric | null {
  return value === "top_topics" ||
    value === "top_keywords" ||
    value === "track_distribution" ||
    value === "papers_per_year" ||
    value === "topic_trend" ||
    value === "keyword_trend" ||
    value === "track_trend"
    ? value
    : null;
}

function normalizeChartType(value: unknown): ChartType | null {
  return value === "bar" ||
    value === "line" ||
    value === "pie" ||
    value === "table" ||
    value === "auto"
    ? value
    : null;
}

function inferMetricFromPrompt(message: string): ChartMetric | null {
  const text = message.toLowerCase();
  const trendIntent =
    /\b(trend|timeline|time series|over time|change|growth|decline|year by year|yearly|annual)\b/i.test(
      text
    );
  if (/\b(keyword|keywords|key word|key words)\b|คีย์เวิร์ด|คำสำคัญ/i.test(text)) {
    return trendIntent ? "keyword_trend" : "top_keywords";
  }
  if (/\b(topic|topics|theme|themes|concept|concepts)\b|หัวข้อ|ประเด็น/i.test(text)) {
    return trendIntent ? "topic_trend" : "top_topics";
  }
  if (/\b(track|tracks|classification|classifications|el\b|eli\b|lae\b)\b/i.test(text)) {
    return trendIntent ? "track_trend" : "track_distribution";
  }
  if (/\b(year|years|trend|timeline|time series|over time|annual)\b|ปี|แนวโน้ม/i.test(text)) {
    return "papers_per_year";
  }
  return null;
}

function inferChartTypeFromPrompt(message: string, metric: ChartMetric): ChartType {
  const text = message.toLowerCase();
  if (/\b(table|list|ranking)\b|ตาราง|รายการ/i.test(text)) {
    return "table";
  }
  if (/\b(pie|donut|doughnut|share|distribution)\b/i.test(text)) {
    return "pie";
  }
  if (/\b(line|trend|timeline|time series|over time)\b/i.test(text)) {
    return metric === "papers_per_year" ||
      metric === "topic_trend" ||
      metric === "keyword_trend" ||
      metric === "track_trend"
      ? "line"
      : "bar";
  }
  if (/\b(bar|column)\b/i.test(text)) {
    return "bar";
  }
  return "auto";
}

function promptRequestsWorkspaceScope(message: string) {
  return /\b(workspace|project|folder|folders|all folders|all papers|all analyzed|all analysed|whole corpus|entire corpus|corpus|library)\b/i.test(
    message
  );
}

function promptRequestsSessionScope(message: string) {
  return /\b(attached|attachment|selected|selected file|selected files|selected paper|selected papers|this paper|this file|current paper|current file|these papers|these files)\b/i.test(
    message
  );
}

function normalizeChartRequest(
  message: string,
  request: ChartRequest | undefined,
  selectedRunIds: string[]
): Required<ChartRequest> {
  const requestedScope =
    request?.scope === "workspace" || request?.scope === "selected_files"
      ? request.scope
      : null;
  const scope: ChartScope =
    requestedScope ??
    (promptRequestsWorkspaceScope(message)
      ? "workspace"
      : promptRequestsSessionScope(message) || selectedRunIds.length > 0
        ? "selected_files"
        : "workspace");
  const metric = normalizeMetric(request?.metric) ?? inferMetricFromPrompt(message) ?? "papers_per_year";
  const groupBy: ChartGroupBy =
    request?.groupBy === "topic" ||
    request?.groupBy === "keyword" ||
    request?.groupBy === "track" ||
    request?.groupBy === "year"
      ? request.groupBy
      : groupByForMetric(metric);
  const chartType =
    normalizeChartType(request?.chartType) ??
    inferChartTypeFromPrompt(message, metric);

  return {
    scope,
    metric,
    groupBy,
    chartType,
    topN: clampInteger(request?.topN, 3, 25, 10),
  };
}

function chartTypeForMetric(
  requestedType: ChartType,
  metric: ChartMetric
): Exclude<ChartType, "auto"> {
  const isTrendMetric =
    metric === "papers_per_year" ||
    metric === "topic_trend" ||
    metric === "keyword_trend" ||
    metric === "track_trend";
  if (isTrendMetric) {
    return requestedType === "table" ? "table" : "line";
  }
  if (requestedType && requestedType !== "auto") {
    return requestedType;
  }
  if (metric === "track_distribution") {
    return "pie";
  }
  return "bar";
}

function addUniquePaperYear(
  rows: Array<{ paper_id: string | number; year?: string | null }>,
  byYear: Map<string, Set<string>>
) {
  rows.forEach((row) => {
    const year = String(row.year ?? "Unknown").trim() || "Unknown";
    const paperId = String(row.paper_id ?? "").trim();
    if (!paperId) {
      return;
    }
    if (!byYear.has(year)) {
      byYear.set(year, new Set());
    }
    byYear.get(year)?.add(paperId);
  });
}

function trackValue(row: TrackRow, track: TrackKey) {
  if (track === "Other") {
    return row.other;
  }
  return row[track.toLowerCase() as "el" | "eli" | "lae"];
}

function topEntries(
  counts: Map<string, number>,
  topN: number,
  sortLabels = false
) {
  const rows = [...counts.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .filter((row) => row.label && row.value > 0);

  rows.sort((left, right) => {
    if (sortLabels) {
      const leftNumber = Number(left.label);
      const rightNumber = Number(right.label);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }
      return left.label.localeCompare(right.label);
    }
    return right.value - left.value || left.label.localeCompare(right.label);
  });

  return rows.slice(0, topN);
}

function normalizeChartText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g, " ").trim();
}

function chartPlannerMetadata(
  request: Required<ChartRequest> | ResolvedChartPlan
): ChatChartPayload["planner"] {
  if ("source" in request) {
    return {
      source: request.source,
      reason: request.reason,
      confidence: request.confidence,
      warnings: request.warnings?.length ? request.warnings : undefined,
    };
  }
  return { source: "fallback" };
}

function chartTitle(
  request: Required<ChartRequest> | ResolvedChartPlan,
  fallbackTitle: string
) {
  return "title" in request && request.title?.trim()
    ? request.title.trim()
    : fallbackTitle;
}

function focusTermsFromPlan(request: Required<ChartRequest> | ResolvedChartPlan) {
  return "focusTerms" in request
    ? request.focusTerms.map((term) => term.trim()).filter(Boolean)
    : [];
}

function focusMatchScore(label: string, focusTerms: string[]) {
  if (focusTerms.length === 0) {
    return 0;
  }
  const normalizedLabel = normalizeChartText(label);
  return focusTerms.reduce((score, term) => {
    const normalizedTerm = normalizeChartText(term);
    if (!normalizedTerm) {
      return score;
    }
    if (normalizedLabel === normalizedTerm) {
      return score + 3;
    }
    if (
      normalizedLabel.includes(normalizedTerm) ||
      normalizedTerm.includes(normalizedLabel)
    ) {
      return score + 2;
    }
    return score;
  }, 0);
}

function prioritizeByFocus(
  rows: Array<{ label: string; value: number }>,
  focusTerms: string[],
  topN: number
) {
  if (focusTerms.length === 0) {
    return rows.slice(0, topN);
  }
  const focused = rows
    .map((row) => ({ ...row, focusScore: focusMatchScore(row.label, focusTerms) }))
    .filter((row) => row.focusScore > 0)
    .sort(
      (left, right) =>
        right.focusScore - left.focusScore ||
        right.value - left.value ||
        left.label.localeCompare(right.label)
    )
    .map(({ focusScore: _focusScore, ...row }) => row);

  return (focused.length > 0 ? focused : rows).slice(0, topN);
}

function metricLabel(row: DashboardData["trends"][number], metric: ChartMetric) {
  if (metric === "top_topics" || metric === "topic_trend") {
    return String(row.topic || row.raw_topic || "Unclassified").trim();
  }
  return String(row.keyword || "").trim();
}

function trendSeriesLimit(request: Required<ChartRequest> | ResolvedChartPlan) {
  return Math.min(Math.max(request.topN, 1), 6);
}

function buildTopicOrKeywordCounts(
  data: DashboardData,
  metric: ChartMetric
) {
  const counts = new Map<string, number>();
  data.trends.forEach((row) => {
    const label = metricLabel(row, metric);
    if (!label) {
      return;
    }
    counts.set(label, (counts.get(label) ?? 0) + Math.max(1, row.keyword_frequency || 0));
  });
  return counts;
}

function buildTrendRows(
  data: DashboardData,
  request: Required<ChartRequest> | ResolvedChartPlan,
  metric: "topic_trend" | "keyword_trend"
) {
  const labelMetric = metric === "topic_trend" ? "top_topics" : "top_keywords";
  const candidateRows = prioritizeByFocus(
    topEntries(buildTopicOrKeywordCounts(data, labelMetric), 100),
    focusTermsFromPlan(request),
    trendSeriesLimit(request)
  );
  const yKeys = candidateRows.map((row) => row.label);
  if (yKeys.length === 0) {
    return null;
  }

  const selectedLabels = new Set(yKeys);
  const rowsByYear = new Map<string, Record<string, string | number>>();
  data.trends.forEach((row) => {
    const label = metricLabel(row, labelMetric);
    if (!selectedLabels.has(label)) {
      return;
    }
    const year = String(row.year ?? "Unknown").trim() || "Unknown";
    const yearRow = rowsByYear.get(year) ?? { label: year };
    yearRow[label] =
      Number(yearRow[label] ?? 0) + Math.max(1, row.keyword_frequency || 0);
    rowsByYear.set(year, yearRow);
  });

  const rows = [...rowsByYear.values()].sort((left, right) =>
    String(left.label).localeCompare(String(right.label), undefined, {
      numeric: true,
    })
  );
  rows.forEach((row) => {
    yKeys.forEach((key) => {
      row[key] = Math.round((Number(row[key]) || 0) * 100) / 100;
    });
  });
  return { rows, yKeys };
}

function buildTrackTrendRows(data: DashboardData) {
  const trackRows = data.tracksSingle.length > 0 ? data.tracksSingle : data.tracksMulti;
  const rowsByYear = new Map<string, Record<string, string | number>>();
  trackRows.forEach((row) => {
    const year = String(row.year ?? "Unknown").trim() || "Unknown";
    const yearRow = rowsByYear.get(year) ?? { label: year };
    TRACK_COLS.forEach((track) => {
      yearRow[track] =
        Number(yearRow[track] ?? 0) + (trackValue(row, track) > 0 ? 1 : 0);
    });
    rowsByYear.set(year, yearRow);
  });

  const rows = [...rowsByYear.values()].sort((left, right) =>
    String(left.label).localeCompare(String(right.label), undefined, {
      numeric: true,
    })
  );
  return { rows, yKeys: [...TRACK_COLS] };
}

function buildChartFromData(
  data: DashboardData,
  request: Required<ChartRequest> | ResolvedChartPlan,
  scopeLabel: string
): ChatChartPayload | null {
  const chartType = chartTypeForMetric(request.chartType, request.metric);
  const planner = chartPlannerMetadata(request);

  if (request.metric === "papers_per_year") {
    const byYear = new Map<string, Set<string>>();
    addUniquePaperYear(data.trends, byYear);
    addUniquePaperYear(data.tracksSingle, byYear);
    addUniquePaperYear(data.tracksMulti, byYear);
    const rows = topEntries(
      new Map([...byYear.entries()].map(([year, paperIds]) => [year, paperIds.size])),
      100,
      true
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      chartType,
      title: chartTitle(request, "Analyzed papers per year"),
      scopeLabel,
      metric: request.metric,
      xKey: "label",
      yKeys: ["value"],
      data: rows,
      planner,
    };
  }

  if (request.metric === "top_topics") {
    const rows = prioritizeByFocus(
      topEntries(buildTopicOrKeywordCounts(data, request.metric), 100),
      focusTermsFromPlan(request),
      request.topN
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      chartType,
      title: chartTitle(request, "Top topics by keyword frequency"),
      scopeLabel,
      metric: request.metric,
      xKey: "label",
      yKeys: ["value"],
      data: rows,
      planner,
    };
  }

  if (request.metric === "top_keywords") {
    const rows = prioritizeByFocus(
      topEntries(buildTopicOrKeywordCounts(data, request.metric), 100),
      focusTermsFromPlan(request),
      request.topN
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      chartType,
      title: chartTitle(request, "Top keywords by frequency"),
      scopeLabel,
      metric: request.metric,
      xKey: "label",
      yKeys: ["value"],
      data: rows,
      planner,
    };
  }

  if (request.metric === "topic_trend" || request.metric === "keyword_trend") {
    const series = buildTrendRows(data, request, request.metric);
    if (!series || series.rows.length === 0) {
      return null;
    }
    return {
      chartType,
      title: chartTitle(
        request,
        request.metric === "topic_trend"
          ? "Topic trend over time"
          : "Keyword trend over time"
      ),
      scopeLabel,
      metric: request.metric,
      xKey: "label",
      yKeys: series.yKeys,
      data: series.rows,
      planner,
    };
  }

  if (request.metric === "track_trend") {
    const series = buildTrackTrendRows(data);
    if (series.rows.length === 0) {
      return null;
    }
    return {
      chartType,
      title: chartTitle(request, "Track trend over time"),
      scopeLabel,
      metric: request.metric,
      xKey: "label",
      yKeys: series.yKeys,
      data: series.rows,
      planner,
    };
  }

  const counts = new Map<string, number>();
  const trackRows = data.tracksSingle.length > 0 ? data.tracksSingle : data.tracksMulti;
  trackRows.forEach((row) => {
    TRACK_COLS.forEach((track) => {
      if (trackValue(row, track) > 0) {
        counts.set(track, (counts.get(track) ?? 0) + 1);
      }
    });
  });
  const rows = topEntries(counts, TRACK_COLS.length);
  if (rows.length === 0) {
    return null;
  }
  return {
    chartType,
    title: chartTitle(request, "Track distribution"),
    scopeLabel,
    metric: request.metric,
    xKey: "label",
    yKeys: ["value"],
    data: rows,
    planner,
  };
}

function buildBestAvailableChartFromData(
  data: DashboardData,
  request: Required<ChartRequest> | ResolvedChartPlan,
  scopeLabel: string
): ChatChartPayload | null {
  const candidateMetrics: ChartMetric[] = [];
  if (data.trends.length > 0) {
    candidateMetrics.push("top_topics", "top_keywords", "topic_trend", "keyword_trend");
  }
  if (data.tracksSingle.length > 0 || data.tracksMulti.length > 0) {
    candidateMetrics.push("track_distribution", "track_trend");
  }
  candidateMetrics.push("papers_per_year");
  const previousWarnings = "warnings" in request ? request.warnings ?? [] : [];

  for (const metric of [...new Set(candidateMetrics)]) {
    const chart = buildChartFromData(
      data,
      {
        ...request,
        metric,
        groupBy: groupByForMetric(metric),
        chartType: "auto",
        source: "fallback",
        focusTerms: "focusTerms" in request ? request.focusTerms : [],
        reason:
          "reason" in request
            ? request.reason
            : "Used deterministic chart inference.",
        confidence:
          "confidence" in request ? request.confidence ?? "medium" : "medium",
        warnings: [
          ...previousWarnings,
          "Used the strongest available chart because the requested chart was empty.",
        ],
      },
      scopeLabel
    );
    if (chart) {
      return chart;
    }
  }

  return null;
}

const CHART_METRIC_VALUES: ChartMetric[] = [
  "papers_per_year",
  "top_topics",
  "top_keywords",
  "track_distribution",
  "topic_trend",
  "keyword_trend",
  "track_trend",
];

function extractJsonObject(text: string | null | undefined) {
  if (!text) {
    return null;
  }
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizePlannerConfidence(value: unknown) {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : undefined;
}

function normalizeFocusTerms(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((term) => String(term ?? "").trim())
        .filter((term) => term.length > 1)
        .slice(0, 8)
    ),
  ];
}

function availableChartMetrics(data: DashboardData): ChartMetric[] {
  const metrics: ChartMetric[] = [];
  const years = new Set<string>();
  [...data.trends, ...data.tracksSingle, ...data.tracksMulti].forEach((row) => {
    const year = String(row.year ?? "").trim();
    if (year) {
      years.add(year);
    }
  });

  if (years.size > 0) {
    metrics.push("papers_per_year");
  }
  if (data.trends.length > 0) {
    metrics.push("top_topics", "top_keywords");
    if (years.size > 1) {
      metrics.push("topic_trend", "keyword_trend");
    }
  }
  if (data.tracksSingle.length > 0 || data.tracksMulti.length > 0) {
    metrics.push("track_distribution");
    if (years.size > 1) {
      metrics.push("track_trend");
    }
  }

  return [...new Set(metrics)];
}

function chartDataProfile(data: DashboardData, scopeLabel: string) {
  const paperIds = new Set<string>();
  const years = new Set<string>();
  [...data.trends, ...data.tracksSingle, ...data.tracksMulti].forEach((row) => {
    const paperId = String(row.paper_id ?? "").trim();
    const year = String(row.year ?? "").trim();
    if (paperId) {
      paperIds.add(paperId);
    }
    if (year) {
      years.add(year);
    }
  });

  const trackCounts = new Map<string, number>();
  const trackRows = data.tracksSingle.length > 0 ? data.tracksSingle : data.tracksMulti;
  trackRows.forEach((row) => {
    TRACK_COLS.forEach((track) => {
      if (trackValue(row, track) > 0) {
        trackCounts.set(track, (trackCounts.get(track) ?? 0) + 1);
      }
    });
  });

  return {
    scopeLabel,
    paperCount: paperIds.size,
    rowCounts: {
      keywordRows: data.trends.length,
      singleTrackRows: data.tracksSingle.length,
      multiTrackRows: data.tracksMulti.length,
    },
    years: [...years].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    ),
    availableMetrics: availableChartMetrics(data),
    topTopics: topEntries(buildTopicOrKeywordCounts(data, "top_topics"), 8),
    topKeywords: topEntries(buildTopicOrKeywordCounts(data, "top_keywords"), 8),
    trackDistribution: topEntries(trackCounts, TRACK_COLS.length),
  };
}

function buildFallbackChartPlan(
  request: Required<ChartRequest>,
  reason = "Used deterministic chart inference."
): ResolvedChartPlan {
  return {
    ...request,
    source: "fallback",
    focusTerms: [],
    reason,
    confidence: "medium",
  };
}

function sanitizePlannerPlan(
  rawPlan: Record<string, unknown> | null,
  fallbackRequest: Required<ChartRequest>,
  availableMetrics: ChartMetric[],
  prompt: string
): ResolvedChartPlan {
  const fallback = buildFallbackChartPlan(fallbackRequest);
  if (!rawPlan) {
    return {
      ...fallback,
      confidence: "low",
      warnings: ["The chart planner did not return valid JSON."],
    };
  }

  const warnings: string[] = [];
  let metric = normalizeMetric(rawPlan.metric);
  if (!metric || !availableMetrics.includes(metric)) {
    warnings.push(
      metric
        ? `Planner requested unavailable metric '${metric}'.`
        : "Planner did not choose a supported metric."
    );
    metric = availableMetrics.includes(fallbackRequest.metric)
      ? fallbackRequest.metric
      : availableMetrics[0] ?? fallbackRequest.metric;
  }

  let chartType = normalizeChartType(rawPlan.chartType);
  if (!chartType) {
    chartType = inferChartTypeFromPrompt(prompt, metric) ?? fallbackRequest.chartType;
  }
  if (
    chartType === "pie" &&
    (metric === "papers_per_year" ||
      metric === "topic_trend" ||
      metric === "keyword_trend" ||
      metric === "track_trend")
  ) {
    warnings.push("Changed pie chart to line chart because the selected metric is time-based.");
    chartType = "line";
  }

  const groupBy =
    rawPlan.groupBy === "year" ||
    rawPlan.groupBy === "topic" ||
    rawPlan.groupBy === "keyword" ||
    rawPlan.groupBy === "track"
      ? rawPlan.groupBy
      : groupByForMetric(metric);
  const topN = clampInteger(rawPlan.topN, 3, 25, fallbackRequest.topN);
  const title = String(rawPlan.title ?? "").trim().slice(0, 96) || undefined;
  const reason = String(rawPlan.reason ?? "").trim().slice(0, 240) || undefined;

  return {
    scope: fallbackRequest.scope,
    metric,
    groupBy,
    chartType,
    topN,
    source: "llm",
    focusTerms: normalizeFocusTerms(rawPlan.focusTerms),
    title,
    reason,
    confidence: normalizePlannerConfidence(rawPlan.confidence) ?? "medium",
    warnings,
  };
}

async function planChartWithLlm(
  body: ChatRequestBody,
  data: DashboardData,
  fallbackRequest: Required<ChartRequest>,
  scopeLabel: string
): Promise<ResolvedChartPlan> {
  const profile = chartDataProfile(data, scopeLabel);
  if (profile.availableMetrics.length === 0) {
    return buildFallbackChartPlan(fallbackRequest, "No chartable analyzed data is available.");
  }

  const recentMessages = (body.messages ?? [])
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").slice(0, 800),
    }));
  const prompt = String(body.message ?? "").trim();

  try {
    const completion = await createChatCompletionResult(
      [
        {
          role: "system",
          content:
            "You are a production chart planner for a research-paper analytics app. " +
            "Choose the most useful chart from the available analyzed data. " +
            "Return strict JSON only. Do not include markdown. Do not invent metrics, columns, or data.",
        },
        {
          role: "user",
          content: JSON.stringify({
            userRequest: prompt || "Create the most useful chart from my analyzed papers.",
            recentChatContext: recentMessages,
            resolvedScope: fallbackRequest.scope,
            selectedFileCount: body.selectedRunIds?.length ?? 0,
            availableMetrics: profile.availableMetrics,
            dataProfile: profile,
            allowedOutput: {
              metric: CHART_METRIC_VALUES,
              chartType: ["auto", "bar", "line", "pie", "table"],
              groupBy: ["year", "topic", "keyword", "track"],
              topN: "integer 3-25",
              focusTerms: "optional keywords/topics/tracks from the user request or data profile",
              title: "short human-readable chart title",
              reason: "one sentence explaining why this chart answers the request",
              confidence: ["high", "medium", "low"],
            },
          }),
        },
      ],
      0.1,
      resolveChatModel(body.model),
      "CHART_PLANNER",
      { maxTokens: 700 }
    );
    return sanitizePlannerPlan(
      extractJsonObject(completion?.content),
      fallbackRequest,
      profile.availableMetrics,
      prompt
    );
  } catch (error) {
    return {
      ...buildFallbackChartPlan(
        fallbackRequest,
        "The LLM chart planner failed, so deterministic inference was used."
      ),
      confidence: "low",
      warnings: [
        error instanceof Error ? error.message : "Chart planner request failed.",
      ],
    };
  }
}

async function loadChartDashboardData(
  ownerUserId: string,
  request: Required<ChartRequest>,
  folderId: string | "all" | undefined,
  projectId: string | undefined,
  selectedRunIds: string[]
) {
  const supabase = getSupabaseAdmin();
  if (request.scope === "selected_files" && selectedRunIds.length > 0) {
    const scopedRunIds = await resolveScopedRunIds(
      supabase,
      ownerUserId,
      selectedRunIds
    );
    return {
      data: await loadScopedDashboardData(ownerUserId, scopedRunIds),
      scopeLabel: `${selectedRunIds.length} selected file${
        selectedRunIds.length === 1 ? "" : "s"
      }`,
    };
  }

  return {
    data: await loadDashboardDataServer(
      ownerUserId,
      folderId && folderId !== "all" ? [folderId] : null,
      projectId && projectId !== "all" ? projectId : null,
      "live"
    ),
    scopeLabel: folderId && folderId !== "all" ? "selected folder" : "workspace",
  };
}

async function buildChatChart(
  ownerUserId: string,
  body: ChatRequestBody
): Promise<{ chart: ChatChartPayload | null; error?: string; request: ResolvedChartPlan }> {
  const prompt = String(body.message ?? "");
  const request = normalizeChartRequest(
    prompt,
    body.chartRequest,
    body.selectedRunIds ?? []
  );
  const fallbackPlan = buildFallbackChartPlan(request);
  if (request.scope === "selected_files" && (body.selectedRunIds ?? []).length === 0) {
    return {
      request: {
        ...fallbackPlan,
        confidence: "low",
        warnings: ["Chart mode needs at least one selected analyzed file for selected-file scope."],
      },
      chart: null,
      error:
        "No selected analyzed paper is attached to this chat request. Add a library file first, then ask for the chart again.",
    };
  }
  const { data, scopeLabel } = await loadChartDashboardData(
    ownerUserId,
    request,
    body.folderId,
    body.projectId,
    body.selectedRunIds ?? []
  );
  const plannedRequest = await planChartWithLlm(body, data, request, scopeLabel);
  const primaryChart = buildChartFromData(data, plannedRequest, scopeLabel);
  const chart =
    primaryChart ??
    buildBestAvailableChartFromData(
      data,
      {
        ...plannedRequest,
        source: "fallback",
        confidence: "low",
        warnings: [
          ...(plannedRequest.warnings ?? []),
          "The planned chart had no rows, so a backup chart was selected.",
        ],
      },
      scopeLabel
    );
  return {
    request: plannedRequest,
    chart,
    error: chart
      ? undefined
      : "No analyzed data was found for that chart scope yet.",
  };
}

function extractWebCitations(annotations: unknown): Citation[] {
  if (!Array.isArray(annotations)) {
    return [];
  }

  const seen = new Set<string>();
  const citations: Citation[] = [];
  annotations.forEach((annotation) => {
    if (!annotation || typeof annotation !== "object") {
      return;
    }
    const citation = (annotation as { url_citation?: Record<string, unknown> })
      .url_citation;
    const url = String(citation?.url ?? "").trim();
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    let host = "web";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      host = "web";
    }
    const title = String(citation?.title ?? host).trim() || host;
    const content = String(citation?.content ?? "").trim();
    citations.push({
      paperId: `Web ${citations.length + 1}`,
      title,
      year: "Web",
      href: url,
      reason: content ? content.slice(0, 220) : host,
      sourceType: "web",
    });
  });
  return citations;
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

function buildFallbackAnswer(question: string, modelError?: string): string {
  const lines = [
    `I could not generate a full response right now for: "${question}".`,
    "Please try again in a moment.",
  ];

  if (modelError) {
    lines.push(`Model note: ${modelError}`);
  }

  return lines.join("\n");
}

type LocalPlanPaper = {
  paper_id: number | string;
  title: string;
  year?: string | null;
  ingestion_run_id?: string | null;
  abstract_claims?: string | null;
  methods?: string | null;
  results?: string | null;
  conclusion?: string | null;
};

const LOCAL_PAYLOAD_VERSION = 3;
const LOCAL_PLANNER_VERSION = "hybrid-v2";
const SECTION_TO_QUERY: Record<string, string> = {
  objective: "research objective",
  theoretical_background: "theoretical background",
  methodology: "methodology methods design",
  participants: "participants sample learners students",
  key_findings: "results findings outcomes",
  limitations: "limitations weaknesses constraints",
  implications: "implications significance practice",
};
const STOPWORDS = new Set([
  "about",
  "after",
  "analysis",
  "analyze",
  "corpus",
  "create",
  "deep",
  "evidence",
  "finish",
  "first",
  "grounded",
  "identify",
  "paper",
  "plan",
  "please",
  "report",
  "research",
  "review",
  "step",
  "steps",
  "structured",
  "then",
  "using",
  "with",
]);

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
    if (candidate.length >= 12 && !isPlaceholderTitle(candidate)) {
      return candidate;
    }
  }
  return "";
}

function isPlaceholderTitle(value: string) {
  const normalized = normalizeTitle(value);
  if (!normalized) return false;
  const placeholderPhrases = new Set([
    "this file",
    "this file here",
    "that file",
    "the file",
    "file here",
    "this paper",
    "that paper",
    "the paper",
    "paper here",
    "attached file",
    "attached paper",
    "attached document",
    "this document",
    "that document",
    "the document",
  ]);
  if (placeholderPhrases.has(normalized)) {
    return true;
  }
  const tokens = new Set(tokenize(normalized));
  const placeholderTokens = new Set(["this", "that", "here", "attached", "file", "paper", "document"]);
  if (tokens.size === 0) return false;
  for (const token of tokens) {
    if (!placeholderTokens.has(token)) return false;
  }
  return true;
}

function extractAttachmentTitles(attachmentNames: string[] = []) {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const name of attachmentNames) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) continue;
    const withoutExt = trimmed.replace(/\.[a-z0-9]{1,6}$/i, "").trim();
    if (withoutExt.length < 4 || isPlaceholderTitle(withoutExt)) continue;
    const normalized = normalizeTitle(withoutExt);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    titles.push(withoutExt);
  }
  return titles;
}

function extractAuthorHint(prompt: string) {
  const match = prompt.match(/(?:^|["'])[^"']+(?:["'])?\s+by\s+([^.,;\n]+)/i);
  return (match?.[1] ?? "").trim();
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeTitle(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeSearchQuery(prompt: string, candidateTitle: string) {
  if (candidateTitle) {
    return candidateTitle;
  }
  return prompt
    .replace(/\b(do|please|can you|could you|run|perform)\b/gi, " ")
    .split(/\b(first create|then identify|finish with|using the selected folder scope|step-by-step plan)\b/i)[0]
    .replace(/\b(deep research|analysis|structured report|report)\b/gi, " ")
    .replace(/\b(this|that)\s+(file|paper|document)(\s+here)?\b/gi, " ")
    .replace(/\battached\s+(file|paper|document)\b/gi, " ")
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
    return { strong: false, ratio: 0 };
  }
  if (normalizedTarget === normalizedPaperTitle) {
    return { strong: true, ratio: 1 };
  }
  const targetTokens = new Set(tokenize(normalizedTarget));
  const titleTokens = new Set(tokenize(normalizedPaperTitle));
  let overlap = 0;
  targetTokens.forEach((token) => {
    if (titleTokens.has(token)) overlap += 1;
  });
  const ratio = overlap / Math.max(1, targetTokens.size);
  const strong =
    ratio >= 0.8 ||
    (targetTokens.size >= 4 && normalizedPaperTitle.includes(normalizedTarget));
  return { strong, ratio };
}

function isExactNormalizedTitleMatch(targetTitle: string, paperTitle: string) {
  const normalizedTarget = normalizeTitle(targetTitle);
  const normalizedPaperTitle = normalizeTitle(paperTitle);
  return Boolean(normalizedTarget) && normalizedTarget === normalizedPaperTitle;
}

function paperTextHaystack(paper: LocalPlanPaper) {
  return [
    paper.title,
    paper.abstract_claims ?? "",
    paper.methods ?? "",
    paper.results ?? "",
    paper.conclusion ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function paperNoisePenalty(paper: LocalPlanPaper) {
  const haystack = paperTextHaystack(paper);
  let penalty = 0;
  const nonAscii = (haystack.match(/[^\x00-\x7F]/g) ?? []).length;
  if (nonAscii > 200) penalty += 10;
  if ((haystack.match(/\bst:|\btt:/g) ?? []).length >= 4) penalty += 6;
  if (haystack.includes("word-by-word translation")) penalty += 8;
  return penalty;
}

function tokenOverlapCount(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap;
}

function scorePaperMatch(
  paper: LocalPlanPaper,
  normalizedQuery: string,
  candidateTitle: string,
  authorHint: string,
  requestedSections: string[],
  selectedScopeAnchor: boolean
) {
  const paperTitle = String(paper.title ?? "");
  const titleMatch = titleMatchStrength(candidateTitle, paperTitle);
  const exactNormalizedTitleMatch = isExactNormalizedTitleMatch(candidateTitle, paperTitle);
  const haystack = paperTextHaystack(paper);
  const titleComponent = exactNormalizedTitleMatch ? 1000 : Math.round(titleMatch.ratio * 160);
  const selectedScopeAnchorBonus = selectedScopeAnchor ? 60 : 0;
  const authorComponent = tokenOverlapCount(authorHint, paperTitle) * 12;
  const requestedSectionTerms = requestedSections
    .map((section) => SECTION_TO_QUERY[section] ?? "")
    .join(" ")
    .trim();
  let requestedSectionComponent = 0;
  tokenize(requestedSectionTerms).forEach((token) => {
    if (token && haystack.includes(token)) {
      requestedSectionComponent += 6;
    }
  });
  let generalComponent = 0;
  tokenize(normalizedQuery).forEach((token) => {
    if (normalizeTitle(paperTitle).includes(token)) {
      generalComponent += 8;
    } else if (haystack.includes(token)) {
      generalComponent += 3;
    }
  });
  const noisePenalty = paperNoisePenalty(paper);
  return {
    paperId: paper.paper_id,
    title: paper.title,
    year: paper.year ?? "Unknown",
    score:
      titleComponent +
      selectedScopeAnchorBonus +
      authorComponent +
      requestedSectionComponent +
      generalComponent -
      noisePenalty,
    strong_title_match: titleMatch.strong,
    exact_normalized_title_match: exactNormalizedTitleMatch,
    selected_scope_anchor: selectedScopeAnchor,
    score_components: {
      title: titleComponent,
      selected_scope_anchor: selectedScopeAnchorBonus,
      author_hint: authorComponent,
      requested_sections: requestedSectionComponent,
      general_content: generalComponent,
      noise_penalty: -noisePenalty,
    },
    ingestion_run_id: paper.ingestion_run_id ?? null,
  };
}

function buildLocalPromptAnalysis(
  prompt: string,
  papers: LocalPlanPaper[],
  selectedRunIds: string[] = [],
  attachmentNames: string[] = []
) {
  let candidateTitle = extractCandidateTitle(prompt);
  const quotedTitle = extractQuotedTitle(prompt);
  const authorHint = extractAuthorHint(prompt);
  const attachmentTitles = extractAttachmentTitles(attachmentNames);
  let selectedScopePapers = papers.filter((paper) =>
    selectedRunIds.includes(String(paper.ingestion_run_id ?? ""))
  );
  if (selectedRunIds.length > 0 && selectedScopePapers.length === 0) {
    selectedScopePapers = [...papers];
  }
  if (!candidateTitle && attachmentTitles.length === 1) {
    candidateTitle = attachmentTitles[0];
  }
  if (!candidateTitle && selectedScopePapers.length === 1) {
    candidateTitle = String(selectedScopePapers[0].title ?? "").trim();
  }
  if (isPlaceholderTitle(candidateTitle)) {
    if (selectedScopePapers.length === 1) {
      candidateTitle = String(selectedScopePapers[0].title ?? "").trim();
    } else if (attachmentTitles.length === 1) {
      candidateTitle = attachmentTitles[0];
    } else {
      candidateTitle = "";
    }
  }
  const normalizedQuery = normalizeSearchQuery(prompt, candidateTitle);
  const lowered = prompt.toLowerCase();
  const requestedSections = detectRequestedSections(prompt);
  const compare = /\b(compare|comparison|versus|contrast)\b/i.test(prompt);
  const survey = /\b(survey|review|overview|landscape|corpus|literature)\b/i.test(prompt);
  const evidenceExtraction =
    requestedSections.length > 0 || /\b(evidence|cite|quote)\b/i.test(prompt);
  const rankedMatches = papers
    .map((paper) =>
      scorePaperMatch(
        paper,
        normalizedQuery,
        candidateTitle,
        authorHint,
        requestedSections,
        selectedRunIds.includes(String(paper.ingestion_run_id ?? ""))
      )
    )
    .filter((row) => row.score > 0 || row.strong_title_match)
    .sort((left, right) => {
      if (Boolean(left.exact_normalized_title_match) !== Boolean(right.exact_normalized_title_match)) {
        return Number(Boolean(right.exact_normalized_title_match)) - Number(Boolean(left.exact_normalized_title_match));
      }
      if (Boolean(left.selected_scope_anchor) !== Boolean(right.selected_scope_anchor)) {
        return Number(Boolean(right.selected_scope_anchor)) - Number(Boolean(left.selected_scope_anchor));
      }
      if (Boolean(left.strong_title_match) !== Boolean(right.strong_title_match)) {
        return Number(Boolean(right.strong_title_match)) - Number(Boolean(left.strong_title_match));
      }
      return right.score - left.score;
    })
    .slice(0, 5);
  let target =
    rankedMatches.find((row) => row.exact_normalized_title_match) ??
    rankedMatches.find((row) => row.selected_scope_anchor && row.strong_title_match) ??
    rankedMatches.find((row) => row.strong_title_match);
  if (!target && candidateTitle && selectedRunIds.length > 0) {
    const selectedMatches = papers
      .filter((paper) => selectedRunIds.includes(String(paper.ingestion_run_id ?? "")))
      .map((paper) =>
        scorePaperMatch(paper, normalizedQuery, candidateTitle, authorHint, requestedSections, true)
      );
    target =
      selectedMatches.find((row) => row.exact_normalized_title_match) ??
      selectedMatches.find((row) => row.selected_scope_anchor && row.strong_title_match) ??
      selectedMatches.find((row) => row.strong_title_match);
    if (!target && selectedMatches.length === 1) {
      const normalizedTargetTokens = new Set(tokenize(candidateTitle));
      const normalizedOnlyTokens = new Set(tokenize(selectedMatches[0].title));
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
    author_hint: authorHint,
    normalized_query: normalizedQuery || prompt.trim(),
    requested_sections: requestedSections,
    attachment_titles: attachmentTitles,
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
  exclusionIds: Array<number | string> = [],
  authorHint = ""
) {
  return {
    primary_query: primaryQuery.trim(),
    supporting_queries: [],
    exact_title_query: targetTitle || null,
    section_query:
      requestedSections.find((section) => SECTION_TO_QUERY[section]) &&
      SECTION_TO_QUERY[requestedSections.find((section) => SECTION_TO_QUERY[section])!],
    author_hint: authorHint || null,
    requested_sections: requestedSections,
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
  targetPaperId?: number | string;
  requestedSections?: string[];
  exclusionIds?: Array<number | string>;
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
    queryBundle: buildLocalQueryBundle(
      args.query,
      requestedSections,
      args.targetTitle ?? "",
      exclusionIds,
      typeof args.promptAnalysis.author_hint === "string" ? args.promptAnalysis.author_hint : ""
    ),
    normalizedQuery: buildLocalQueryBundle(
      args.query,
      requestedSections,
      args.targetTitle ?? "",
      exclusionIds,
      typeof args.promptAnalysis.author_hint === "string" ? args.promptAnalysis.author_hint : ""
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
    targetPaperId?: number | string;
    requestedSections?: string[];
    exclusionIds?: Array<number | string>;
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
    .select("paper_id,title,year,folder_id,ingestion_run_id,abstract_claims,methods,results,conclusion")
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
  selectedRunIds: string[] = [],
  attachmentNames: string[] = []
) {
  const papers = await loadScopedPlanPapers(ownerUserId, folderId, projectId, selectedRunIds);
  const promptAnalysis = buildLocalPromptAnalysis(prompt, papers, selectedRunIds, attachmentNames);
  const needsAnalysis = pendingRunCount > 0;
  const requestedSections = Array.isArray(promptAnalysis.requested_sections)
    ? promptAnalysis.requested_sections
    : [];
  const normalizedQuery = String(promptAnalysis.normalized_query || prompt).trim();
  const candidateTitle = String(promptAnalysis.candidate_title || "");
  const targetPaperId =
    (typeof promptAnalysis.target_paper_id === "string" ||
      typeof promptAnalysis.target_paper_id === "number")
      ? promptAnalysis.target_paper_id
      : 0;
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
  const attachmentNames = (body.attachments ?? [])
    .map((attachment) => String(attachment?.name ?? "").trim())
    .filter(Boolean);
  const selectedRunIds = body.selectedRunIds ?? [];
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
    const attachmentNames = (body.attachments ?? [])
      .map((attachment) => String(attachment?.name ?? "").trim())
      .filter(Boolean);
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
      selectedRunIds,
      attachmentNames,
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
      selectedRunIds,
      attachmentNames
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

  const requestedToolMode: ChatToolMode = body.toolMode ?? "auto";
  const chartRequested =
    requestedToolMode === "chart" ||
    Boolean(body.chartRequest);

  if (chartRequested) {
    if (!ownerUserId || !supabase || !thread) {
      return NextResponse.json(
        { error: "Sign in to build charts from workspace data." },
        { status: 401 }
      );
    }

    let chart: ChatChartPayload | null = null;
    let chartError: string | undefined;
    let normalizedChartRequest: ResolvedChartPlan | null = null;
    try {
      const result = await buildChatChart(ownerUserId, body);
      chart = result.chart;
      chartError = result.error;
      normalizedChartRequest = result.request;
    } catch (error) {
      chartError =
        error instanceof Error ? error.message : "Failed to build chart.";
    }

    const toolResults: ChatToolResult[] = [
      chart
        ? { type: "chart", status: "succeeded", data: chart }
        : { type: "chart", status: "failed", error: chartError },
    ];
    const answer = chart
      ? `I built **${chart.title}** from ${chart.scopeLabel}.`
      : `I could not build that chart yet. ${chartError ?? "No analyzed data was found."}`;
    const metadata = {
      mode: chart ? "grounded" : "fallback",
      toolResults,
      chart,
      chartRequest: normalizedChartRequest,
    };

    await appendWorkspaceMessage(supabase, {
      threadId: thread.id,
      ownerUserId,
      folderId: body.folderId,
      role: "assistant",
      content: answer,
      messageKind: "chat",
      citations: [],
      metadata,
    });
    await updateWorkspaceThread(supabase, thread.id, {
      summary: answer.slice(0, 240),
      title: thread.title || buildThreadTitle(currentMessage),
    });

    const detail = await getWorkspaceThreadDetail(supabase, ownerUserId, thread.id);
    return NextResponse.json({
      mode: chart ? "grounded" : "fallback",
      answer,
      citations: [],
      toolResults,
      chart,
      thread: detail.thread,
      messages: detail.messages,
      deepResearchSession: detail.deepResearchSession,
    });
  }

  const citations: Citation[] = [];
  let mode: "grounded" | "fallback" = "fallback";
  const generationOptions = resolveGenerationOptions(body);
  const selectedModel = resolveChatModel(body.model);
  const webSearchRequested =
    requestedToolMode === "web_search" ||
    Boolean(body.webSearchEnabled) ||
    (requestedToolMode === "auto" && hasWebSearchIntent(currentMessage));
  const webSearchTools = webSearchRequested
    ? [
        {
          type: "openrouter:web_search",
          parameters: {
            max_results: 5,
            max_total_results: 8,
            search_context_size: "medium",
          },
        },
      ]
    : undefined;
  const toolResults: ChatToolResult[] = [];

  const history = (body.messages ?? [])
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").trim(),
    }))
    .filter((message) => Boolean(message.content))
    .slice(-16);

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content:
        "You are a helpful, general-purpose assistant. Respond conversationally and clearly. " +
        "Do not assume access to workspace databases, filters, or paper corpora unless the user explicitly provides that context in the chat.",
    },
  ];

  if (history.length > 0) {
    chatMessages.push(...history);
  } else {
    chatMessages.push({ role: "user", content: currentMessage });
  }

  if (attachmentContext) {
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      if (chatMessages[index].role === "user") {
        chatMessages[index] = {
          ...chatMessages[index],
          content: `${chatMessages[index].content}${attachmentContext}`,
        };
        break;
      }
    }
  }

  let answer = "";
  let modelError: string | undefined;
  try {
    const completion = await createChatCompletionResult(
      chatMessages,
      generationOptions.temperature ?? 0.4,
      selectedModel,
      "CHAT_SYNTHESIS",
      {
        topP: generationOptions.topP,
        topK: generationOptions.topK,
        maxTokens: generationOptions.maxTokens,
        frequencyPenalty: generationOptions.frequencyPenalty,
        presencePenalty: generationOptions.presencePenalty,
        tools: webSearchTools,
        toolChoice: webSearchRequested ? "auto" : undefined,
      }
    );
    answer = completion?.content ?? "";
    const webCitations = extractWebCitations(completion?.annotations ?? []);
    citations.push(...webCitations);
    if (webSearchRequested) {
      toolResults.push({
        type: "web_search",
        status: webCitations.length > 0 ? "succeeded" : "skipped",
        citations: webCitations,
      });
    }
  } catch (error) {
    modelError = error instanceof Error ? error.message : "Model request failed.";
    if (webSearchRequested) {
      toolResults.push({
        type: "web_search",
        status: "failed",
        error: modelError,
      });
    }
  }

  if (!answer) {
    answer = buildFallbackAnswer(currentMessage, modelError);
  }
  if (citations.length > 0 || webSearchRequested) {
    mode = "grounded";
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
      metadata: {
        mode,
        model: selectedModel,
        toolResults,
        webSearchEnabled: webSearchRequested,
      },
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
      toolResults,
      thread: detail.thread,
      messages: detail.messages,
      deepResearchSession: detail.deepResearchSession,
    });
  }

  return NextResponse.json({
    mode,
    answer,
    citations,
    toolResults,
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
