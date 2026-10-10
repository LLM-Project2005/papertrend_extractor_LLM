/*
 * Charts in chat (docs/31, phase 1), drawn by the Adaptive tab's question
 * engine rather than by three fixed charts.
 *
 * The chat's own chart step drew top raw topics, raw topics by year, or word
 * counts, whatever was asked: "papers per year" got a topic chart, "methods in
 * writing papers" got every topic in the repository. Now one small forced call
 * turns the question into a view - which dimension, against which, narrowed to
 * what - and code computes it from the same themed, deduplicated papers the
 * dashboard draws. The model never writes a number: the chart, its title and
 * its caption are computed. A question the papers' data cannot answer gets a
 * reason and what can be charted instead, not a chart of something else.
 */
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { createChatCompletionResult } from "@/lib/openai";
import { buildInsightCorpus, type CorpusInput, type InsightCorpus } from "@/lib/insights/corpus";
import { buildInsightReport } from "@/lib/insights/engine";
import { loadPaperProfiles } from "@/lib/insights/server";
import { askMessages, askTool, askVocabulary, parseAskQuery, runAskQuery, type AskQuery } from "@/lib/insights/ask";
import { MIN_PAPERS } from "@/lib/insights/stats";
import type { Insight } from "@/lib/insights/types";
import type { PaperId } from "@/types/database";

/** The request chart mode sends when the reader typed nothing. */
export const BLANK_CHART_REQUEST = "Create the most useful chart from my analyzed papers.";

/** A chart the chat draws with the Adaptive tab's renderer. */
export interface ChatInsightChart {
  chartType: "insight";
  metric: "insight";
  title: string;
  scopeLabel: string;
  xKey: "label";
  yKeys: string[];
  data: Array<Record<string, string | number>>;
  insight: Insight;
  /** Titles of the papers behind the chart, so a bar can list them. */
  papers: Array<{ id: string; title: string; year: string }>;
  planner: { source: "llm" | "fallback"; reason: string; confidence: "high" | "medium" | "low"; warnings: string[] };
}

export interface ChatChartOutcome {
  answer: string;
  chart: ChatInsightChart | null;
  /** The view that was asked for, for diagnostics and the evaluation. */
  query: AskQuery | null;
}

const WHAT_CAN_BE_CHARTED =
  "I can chart how these papers divide by theme, method, research area, contribution, kind of study, aim or year, and cross any two - for example \"methods by theme\" or \"how the themes changed\" - and what the papers report, read from their text: \"participants in each study\", \"where the studies were done\", or the figures in a paper's table.";
const WHAT_CAN_BE_CHARTED_TH =
  "แผนภูมิที่ทำได้คือการแบ่งงานวิจัยตามหัวข้อ วิธีวิจัย หมวดหมู่ ประเภทผลงาน ประเภทการศึกษา จุดมุ่งหมาย หรือปี และการไขว้สองมิติเข้าด้วยกัน เช่น \"วิธีวิจัยในแต่ละหัวข้อ\" \"จำนวนงานวิจัยต่อปี\" หรือ \"หัวข้อที่เปลี่ยนไปตามเวลา\" รวมถึงสิ่งที่งานวิจัยรายงานไว้ในเนื้อหา เช่น \"จำนวนผู้เข้าร่วมในแต่ละงานวิจัย\" \"ประเทศที่ทำการศึกษา\" หรือตัวเลขในตารางของงานวิจัยฉบับหนึ่ง";

/**
 * The chat scope's papers as the dashboard sees them: its themes, methods and
 * categories, one record per study. Loaded per repository and cut to the papers
 * the chat has in scope (a folder, or papers the reader attached).
 */
export async function loadChatInsightCorpus(ownerUserId: string, projectIds: string[], paperIds: Set<string>): Promise<InsightCorpus> {
  const merged: Required<Pick<CorpusInput, "trends" | "categoryAssignments" | "tracksSingle">> & { classificationEnabled: boolean } = {
    trends: [],
    categoryAssignments: [],
    tracksSingle: [],
    classificationEnabled: false,
  };
  for (const projectId of [...new Set(projectIds)].slice(0, 12)) {
    const data = await loadDashboardDataServer(ownerUserId, [], projectId, "live");
    const filtered = filterDashboardData(data, [], [], "");
    const keep = <T extends { paper_id: PaperId }>(rows: T[] | undefined) => (rows ?? []).filter((row) => paperIds.has(String(row.paper_id)));
    merged.trends.push(...keep(filtered.trends));
    merged.categoryAssignments.push(...keep(filtered.categoryAssignments));
    merged.tracksSingle.push(...keep(filtered.tracksSingle));
    if (data.classificationEnabled !== false) merged.classificationEnabled = true;
  }
  const ids = [...new Set(merged.trends.map((row) => row.paper_id))];
  const profiles = await loadPaperProfiles(ownerUserId, ids).catch(() => new Map());
  return buildInsightCorpus(merged, profiles);
}

function isThai(language: string | undefined, question: string): boolean {
  return /thai|ไทย/i.test(language ?? "") || /[ก-๛]/.test(question);
}

function numbersOf(text: string): string {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(",");
}

/**
 * The chart's words in Thai for a Thai question. The labels stay as the papers
 * name them; a translation that changes any number is not used.
 */
export async function inThai(texts: string[]): Promise<string[]> {
  try {
    const result = await createChatCompletionResult(
      [
        {
          role: "system",
          content:
            "Translate each string in the JSON array into natural Thai for a researcher. Keep every number exactly as written, and keep names of themes, methods and categories in English. Reply with a JSON object {\"items\": [...]} with the same number of strings, in order.",
        },
        { role: "user", content: JSON.stringify(texts) },
      ],
      0,
      undefined,
      "CHAT_CHART_QUERY",
      { maxTokens: 900, jsonObject: true, timeoutMs: 15_000 }
    );
    const parsed = JSON.parse(result?.content ?? "{}") as { items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items.map(String) : [];
    if (items.length !== texts.length) return texts;
    return texts.map((text, index) => (numbersOf(items[index]) === numbersOf(text) && items[index].trim() ? items[index] : text));
  } catch {
    return texts;
  }
}

function chartPayload(insight: Insight, corpus: InsightCorpus, scopeLabel: string, source: "llm" | "fallback"): ChatInsightChart {
  const byId = new Map(corpus.papers.map((paper) => [String(paper.id), paper]));
  const papers = insight.paperIds
    .map((id) => byId.get(String(id)))
    .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper))
    .map((paper) => ({ id: String(paper.id), title: paper.title, year: paper.year === null ? "Unknown" : String(paper.year) }));
  // A flat table of the values, for a stored message, an export or a screen reader.
  const data: Array<Record<string, string | number>> =
    insight.chart.kind === "bars"
      ? insight.chart.rows.map((row) => ({ label: row.label, value: row.value }))
      : insight.chart.kind === "compare"
        ? insight.chart.rows.map((row) => ({ label: row.label, [(insight.chart as { leftLabel: string }).leftLabel]: row.left, [(insight.chart as { rightLabel: string }).rightLabel]: row.right }))
        : insight.chart.kind === "matrix"
          ? insight.chart.rows.map((label, r) => ({ label, ...Object.fromEntries((insight.chart as { cols: string[]; values: number[][] }).cols.map((col, c) => [col, (insight.chart as { values: number[][] }).values[r][c]])) }))
          : [];
  return {
    chartType: "insight",
    metric: "insight",
    title: insight.question,
    scopeLabel,
    xKey: "label",
    yKeys: data[0] ? Object.keys(data[0]).filter((key) => key !== "label") : [],
    data,
    insight,
    papers,
    planner: { source, reason: "", confidence: "high", warnings: [] },
  };
}

/**
 * Answers a chart request over the papers in scope.
 *
 * `question` is what the reader typed; `restated` is the planner's
 * self-contained version, which carries a follow-up's missing subject.
 */
export async function chatChartResult(input: {
  corpus: InsightCorpus;
  question: string;
  restated?: string | null;
  scopeLabel: string;
  answerLanguage?: string;
  /** The view Chart mode's planner already chose (chart-reading.ts), so it is not asked for again. */
  query?: AskQuery | null;
}): Promise<ChatChartOutcome> {
  const thai = isThai(input.answerLanguage, input.question);
  const { corpus } = input;
  const finish = async (answer: string, chart: ChatInsightChart | null, query: AskQuery | null): Promise<ChatChartOutcome> => {
    if (!thai) return { answer, chart, query };
    if (!chart) {
      const [translated] = await inThai([answer]);
      return { answer: translated, chart, query };
    }
    const [title, takeaway, basis] = await inThai([chart.insight.question, chart.insight.takeaway, chart.insight.basis]);
    const insight = { ...chart.insight, question: title, takeaway, basis };
    return { answer: takeaway, chart: { ...chart, title, insight }, query };
  };

  if (corpus.papers.length < MIN_PAPERS) {
    return finish(
      `A chart needs at least ${MIN_PAPERS} analysed papers in scope; ${corpus.papers.length === 1 ? "one is" : `${corpus.papers.length} are`}. Widen the scope or wait for analysis to finish.`,
      null,
      null
    );
  }

  // Nothing typed: the strongest pattern the engine found, as the Adaptive tab leads with.
  if (input.question.trim() === BLANK_CHART_REQUEST || !input.question.trim()) {
    const top = buildInsightReport(corpus).insights[0];
    if (top) return finish(top.takeaway, chartPayload(top, corpus, input.scopeLabel, "fallback"), null);
  }

  const asked = input.restated && input.restated.trim() && input.restated.trim() !== input.question.trim()
    ? `${input.question.trim()}\n(Restated with the conversation: ${input.restated.trim()})`
    : input.question.trim();
  let query: AskQuery | null = input.query ?? null;
  if (!query) {
    try {
      const result = await createChatCompletionResult(
        askMessages(asked.slice(0, 700), askVocabulary(corpus), input.scopeLabel),
        0,
        undefined,
        "CHAT_CHART_QUERY",
        {
          maxTokens: 400,
          tools: [askTool()],
          toolChoice: { type: "function", function: { name: "build_view" } },
          parallelToolCalls: false,
          timeoutMs: 20_000,
        }
      );
      const call = result?.toolCalls.find((entry) => entry.function?.name === "build_view");
      try {
        query = parseAskQuery(JSON.parse(call?.function?.arguments ?? result?.content ?? "null"));
      } catch {
        query = null;
      }
    } catch (error) {
      console.warn("chat_chart_query_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  if (!query) {
    return finish(`The chart could not be worked out just now. ${WHAT_CAN_BE_CHARTED} Try asking again.`, null, null);
  }
  const answer = runAskQuery(corpus, query);
  if ("unanswerable" in answer) {
    const reason = answer.unanswerable.trim().replace(/([^.!?])$/, "$1.");
    if (thai) {
      const [translated] = await inThai([reason]);
      return { answer: `${translated} ${WHAT_CAN_BE_CHARTED_TH}`, chart: null, query };
    }
    return { answer: `${reason} ${WHAT_CAN_BE_CHARTED}`, chart: null, query };
  }
  const chart = chartPayload(answer.insight, corpus, input.scopeLabel, "llm");
  return finish(answer.insight.takeaway, chart, query);
}
