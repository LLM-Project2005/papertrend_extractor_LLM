/*
 * The 2026-10-09 review with the project's professor: charts of one or two
 * papers, words per section, chart labels that fit, a queue wait that belongs
 * to this round, example questions these papers can answer, today's usage,
 * and old dashboard links that land on the tabs that replaced them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildRepositoryTermCounts } from "../src/lib/repository-text";
import { asksForSectionWordCounts, smallScopeChartResult, wordCountResult } from "../src/lib/repository-chat";
import type { PaperContentSource, RepositoryContext, RepositoryDataChart, RepositoryPaper, RepositoryPromptPlan } from "../src/lib/repository-chat";
import { wrapLabel } from "../src/components/chat/ChatChartCard";
import { queueWaitThisRound } from "../src/components/workspace/AnalysisStatusCard";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import { runAskQuery } from "../src/lib/insights/ask";
import { answerableQueries, applyWordings, templateQuestion } from "../src/lib/insights/suggestions";
import { usageShare } from "../src/components/chat/UsageMeter";
import { utcDayBounds } from "../src/lib/ai-usage-today";
import type { IngestionRunRow, TrendRow } from "../src/types/database";

function paper(overrides: Partial<RepositoryPaper> & { paperId: string; title: string }): RepositoryPaper {
  const content = overrides.content ?? "";
  const index = buildRepositoryTermCounts(content);
  return {
    runId: `run-${overrides.paperId}`,
    folderId: "folder-1",
    year: "2022",
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content,
    contentHash: `hash-${overrides.paperId}`,
    contentSource: "full_text" as PaperContentSource,
    totalWords: index.totalWords,
    termCounts: index.termCounts,
    topics: new Map(),
    keywords: new Map(),
    ...overrides,
  };
}

function context(papers: RepositoryPaper[]): RepositoryContext {
  return {
    ownerUserId: "owner-1",
    projectId: "project-1",
    folderId: null,
    selectedRunIds: [],
    knowledgeScope: { kind: "project", projectId: "project-1" },
    scopeSnapshot: { kind: "project", label: "Test", projectId: "project-1", projectName: "Test", folderId: null, folderName: null, selectedRunCount: 0, eligiblePaperCount: papers.length },
    projects: [{ id: "project-1", name: "Test" }],
    scopeLabel: "Test",
    versionHash: "v",
    summaryMarkdown: "",
    papers,
    topicCounts: [],
    keywordCounts: [],
    totalWords: 0,
    runStats: { total: papers.length, succeeded: papers.length, queued: 0, processing: 0, failed: 0, canceled: 0, other: 0 },
  } as RepositoryContext;
}

function plan(overrides: Partial<RepositoryPromptPlan> = {}): RepositoryPromptPlan {
  return {
    intent: "word_count",
    refinedQuestion: "count num word in each section. and plot to a bar chart",
    terms: ["section word count"],
    retrievalQueries: [],
    evidenceNeeds: [],
    answerLanguage: "English",
    retrievalMode: "lexical",
    needsChart: true,
    chartType: "bar",
    reason: "",
    confidence: "high",
    source: "llm",
    ...overrides,
  } as RepositoryPromptPlan;
}

const BRANDING = paper({
  paperId: "1",
  title: "Thailand's Exported Food Product Brand Naming: A Focus on Semantics and Pragmatics",
  abstract: "Brand names carry meaning beyond the product they name.",
  methods: "We collected 175 brand names from five categories of exported food.",
  results: "Most names used descriptive strategies, and many flouted a Gricean maxim on purpose.",
  conclusion: "Meaning and context together make a name persuasive.",
  keywords: new Map([["brand names", 12], ["pragmatics", 7], ["semantics", 5], ["gricean maxims", 3]]),
});

/* ------------------------------------------------------------ chart mode */

test("words in each section is read as the paper's parts, not as the word 'section'", () => {
  // The test account's chat: "count num word in each section" charted the term
  // "section word count", which appears nowhere, as a row of zeros.
  assert.equal(asksForSectionWordCounts("count num word in each section. and plot to a bar chart", ["section word count"]), true);
  assert.equal(asksForSectionWordCounts("how many words are in each section?", []), true);
  assert.equal(asksForSectionWordCounts("how often does 'feedback' appear?", ["feedback"]), false);
  const result = wordCountResult(context([BRANDING]), plan());
  assert.match(result.answer, /## Words in each section/);
  assert.match(result.answer, /\| Abstract \| Methods \| Results \| Conclusion \| Whole paper \|/);
  const chart = result.charts[0] as RepositoryDataChart;
  assert.deepEqual(chart.data.map((row) => row.label), ["Abstract", "Methods", "Results", "Conclusion"]);
  assert.deepEqual(chart.data.map((row) => row.words), ["abstract", "methods", "results", "conclusion"].map((key) => buildRepositoryTermCounts(BRANDING[key as "abstract"]).totalWords));
});

test("Chart mode draws one or two papers from what each paper holds, instead of refusing", () => {
  const one = smallScopeChartResult("show me a chart", context([BRANDING]), plan({ refinedQuestion: "show me a chart", terms: [] }));
  assert.equal(one.charts.length, 1);
  const chart = one.charts[0] as RepositoryDataChart;
  assert.equal(chart.metric, "keyword_frequency");
  assert.deepEqual(chart.data.map((row) => row.label), ["brand names", "pragmatics", "semantics", "gricean maxims"]);
  assert.match(one.answer, /uses “brand names” most often \(12 times\)/);
  assert.match(one.answer, /needs at least 3 in scope/);

  const second = paper({ paperId: "2", title: "Naming coffee in Chiang Mai", keywords: new Map([["brand names", 4], ["coffee", 9]]) });
  const two = smallScopeChartResult("compare their keywords", context([BRANDING, second]), plan({ refinedQuestion: "compare", terms: [] }));
  const pair = two.charts[0] as RepositoryDataChart;
  assert.equal(pair.yKeys.length, 2, "one series per paper");
  assert.match(two.answer, /Both papers use “brand names”/);

  const sections = smallScopeChartResult("words per section please", context([BRANDING]), plan({ refinedQuestion: "words per section please", terms: [] }));
  assert.match(sections.answer, /Words in each section/);
});

test("a long chart label wraps to two lines and says when it was cut", () => {
  assert.deepEqual(wrapLabel("Methods", 20), ["Methods"]);
  const lines = wrapLabel("A Study of Native English Speakers’ Usage of the English Present Tense", 24);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.length <= 24), JSON.stringify(lines));
  assert.ok(lines[1].endsWith("…"), "the cut shows");
  const card = readFileSync(new URL("../src/components/chat/ChatChartCard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /h-\[320px\]/, "the bar chart grows with its rows");
});

/* ------------------------------------------------------------ the tray */

test("the queue wait is this round's, not the time since the first upload", () => {
  const run = (wait: number, created: string, requeued?: string) =>
    ({
      id: "r",
      status: "succeeded",
      created_at: created,
      input_payload: { analysis_metrics: { queue_wait_seconds: wait }, ...(requeued ? { reanalysis_requested_at: requeued } : {}) },
    }) as unknown as IngestionRunRow;
  assert.equal(queueWaitThisRound(run(42, "2026-10-09T10:00:00Z")), 42);
  // Analysed again a week later: the worker reported the whole week.
  const week = 7 * 24 * 3600;
  assert.equal(queueWaitThisRound(run(week + 30, "2026-10-01T10:00:00Z", "2026-10-08T10:00:00Z")), 30);
  // Metrics from the earlier round, before this one has started: no wait to show.
  assert.equal(queueWaitThisRound(run(20, "2026-10-01T10:00:00Z", "2026-10-08T10:00:00Z")), null);
  assert.equal(queueWaitThisRound(run(3 * 24 * 3600, "2026-10-01T10:00:00Z")), null, "longer than a session");
});

/* -------------------------------------------------------- Adaptive examples */

function trend(paperId: string, year: string, topic: string, kind: "topic" | "method" = "topic"): TrendRow {
  return { paper_id: paperId, year, title: `Paper ${paperId}`, topic, keyword: topic.toLowerCase(), keyword_frequency: 1, evidence: "", topic_kind: kind } as TrendRow;
}

test("every example question offered is one these papers answer", () => {
  const trends: TrendRow[] = [];
  for (let paper = 1; paper <= 12; paper += 1) {
    const year = String(2016 + (paper % 6));
    trends.push(trend(String(paper), year, paper % 3 ? "Mangrove restoration" : "Managed retreat"));
    trends.push(trend(String(paper), year, paper % 2 ? "Household surveys" : "Interviews", "method"));
  }
  const corpus = buildInsightCorpus({ trends });
  const queries = answerableQueries(corpus);
  assert.ok(queries.length >= 2, `found ${queries.length}`);
  for (const query of queries) {
    const result = runAskQuery(corpus, query);
    assert.ok("insight" in result, `${query.title} answers`);
  }
  // A wording that drops the value a view is about falls back to plain words.
  const focused = queries.find((query) => query.focus) ?? { ...queries[0], focus: { dimension: "theme" as const, values: ["Mangrove restoration"] } };
  const [kept] = applyWordings([focused], { questions: ["Which methods do these coastal studies use?"] });
  assert.equal(kept.question, templateQuestion(focused));
  const [worded] = applyWordings([focused], { questions: [`Which methods do studies of ${focused.focus!.values[0]} rely on?`] });
  assert.match(worded.question, /rely on\?$/);
});

/* -------------------------------------------------------------- usage */

test("today's usage is counted over the UTC day, and its share stays between none and all", () => {
  const { since, resetsAt } = utcDayBounds(new Date("2026-10-09T23:30:00+07:00"));
  assert.equal(since, "2026-10-09T00:00:00.000Z");
  assert.equal(resetsAt, "2026-10-10T00:00:00.000Z");
  assert.equal(usageShare({ used: 250_000, limit: 1_000_000 }), 0.25);
  assert.equal(usageShare({ used: 2_000_000, limit: 1_000_000 }), 1);
  assert.equal(usageShare({ used: 5, limit: 0 }), 0);
});

/* ------------------------------------------------------------ dashboard */

test("the dashboard opens on the semantic map, and old links land on the tab that replaced theirs", () => {
  const source = readFileSync(new URL("../src/components/DashboardClient.tsx", import.meta.url), "utf8");
  assert.match(source, /const DEFAULT_TAB = "semantic_map";/);
  for (const [old, now] of [["overview", "DEFAULT_TAB"], ["trend_analysis", '"area_analysis"'], ["track_analysis", '"area_analysis"']]) {
    assert.match(source, new RegExp(`${old}: ${now}`), old);
  }
  const map = readFileSync(new URL("../src/components/workspace/RepositorySemanticMap.tsx", import.meta.url), "utf8");
  assert.match(map, /useState<LayoutMode>\("force"\)/, "the free graph is the default layout");
});
