import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import { runAskQuery, type AskQuery } from "../src/lib/insights/ask";
import { BLANK_CHART_REQUEST, chatChartResult } from "../src/lib/chat-chart";
import type { CategoryAssignmentRow, TrendRow } from "../src/types/database";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** 30 papers: Reading, Vocabulary and Speaking 10 each; Writing 6; Testing 4; a gap at 2014-2016. */
function corpus() {
  const trends: TrendRow[] = [];
  const categories: CategoryAssignmentRow[] = [];
  const add = (paper: number, year: number | null, topic: string, kind: "topic" | "method" = "topic") =>
    trends.push({
      paper_id: String(paper),
      year: year === null ? "Unknown" : String(year),
      title: `Paper ${paper}`,
      topic,
      topic_kind: kind,
      keyword: topic.toLowerCase(),
      keyword_frequency: 1,
      evidence: "",
    });
  for (let paper = 1; paper <= 30; paper += 1) {
    const year = paper === 30 ? null : paper <= 10 ? 2010 + (paper % 4) : 2017 + (paper % 6);
    add(paper, year, paper % 3 === 0 ? "Reading" : paper % 3 === 1 ? "Vocabulary" : "Speaking");
    if ([2, 5, 8, 11, 20, 23].includes(paper)) add(paper, year, "Writing");
    if ([10, 15, 20, 25].includes(paper)) add(paper, year, "Testing");
    if ([2, 5, 8, 21, 24, 27].includes(paper)) add(paper, year, "Mixed methods", "method");
    if ([1, 3, 6, 11, 20].includes(paper)) add(paper, year, "Interviews", "method");
    categories.push({ paper_id: String(paper), year: String(year), title: `Paper ${paper}`, category_key: paper % 5 === 0 ? "lae" : "eli", category_label: paper % 5 === 0 ? "Assessment" : "Instruction", assignment_type: "single" });
  }
  return buildInsightCorpus({ trends, categoryAssignments: categories, classificationEnabled: true });
}

const ask = (query: Partial<AskQuery>) => runAskQuery(corpus(), { answerable: true, title: "", measure: "papers", rows: "theme", columns: null, focus: null, about: [], ...query });

test("papers per year: every year in the span, gaps shown as empty, undated said", () => {
  const answer = ask({ rows: "year" });
  assert.ok("insight" in answer);
  if (!("insight" in answer) || answer.insight.chart.kind !== "bars") return;
  const years = answer.insight.chart.rows.map((row) => row.label);
  assert.deepEqual(years.slice(0, 5), ["2010", "2011", "2012", "2013", "2014"]);
  assert.equal(answer.insight.chart.rows.find((row) => row.label === "2015")?.value, 0, "an empty year is drawn, not squeezed out");
  assert.equal(answer.insight.question, "Papers per year");
  assert.match(answer.insight.takeaway, /^The 30 papers selected run from 2010 to 2022; /);
  assert.match(answer.insight.basis, /One paper has no readable year and is left out of the years\./);
});

test("comparing named values draws those values", () => {
  const answer = ask({ rows: "theme", about: ["Writing", "Reading"] });
  assert.ok("insight" in answer);
  if (!("insight" in answer) || answer.insight.chart.kind !== "bars") return;
  assert.deepEqual(answer.insight.chart.rows.map((row) => row.label).sort(), ["Reading", "Writing"]);
  assert.equal(answer.insight.takeaway, "Among the 30 papers selected, Writing appears in 6 (20%) and Reading in 10 (33%).");
});

test("a subject on the columns' dimension picks those columns", () => {
  // "Compare the methods in writing and reading papers": method by theme, only those two themes.
  const answer = ask({ rows: "method", columns: "theme", focus: { dimension: "theme", values: ["Writing", "Reading"] } });
  assert.ok("insight" in answer);
  if (!("insight" in answer) || answer.insight.chart.kind !== "matrix") return;
  assert.deepEqual([...answer.insight.chart.cols].sort(), ["Reading", "Writing"]);
});

test("themes alongside a subject leave the subject out", () => {
  const answer = ask({ rows: "theme", focus: { dimension: "theme", values: ["Writing"] } });
  assert.ok("insight" in answer);
  if (!("insight" in answer) || answer.insight.chart.kind !== "bars") return;
  assert.equal(answer.insight.chart.rows.some((row) => row.label === "Writing"), false);
  assert.equal(answer.insight.question, "Other themes in papers on Writing");
  assert.match(answer.insight.takeaway, /the most common other theme/);
});

test("a value too rare to show a change is said to be, not swapped for another", () => {
  const answer = ask({ rows: "method", measure: "change", about: ["Interviews"] });
  assert.ok("insight" in answer);
  if ("insight" in answer) assert.doesNotMatch(answer.insight.takeaway, /^Among .* the biggest change is Mixed methods/);
});

test("titles and captions read as English", () => {
  const byCategory = ask({ rows: "category" });
  assert.ok("insight" in byCategory);
  if (!("insight" in byCategory)) return;
  assert.equal(byCategory.insight.question, "Papers by category", "not 'Categorys'");
  assert.doesNotMatch(byCategory.insight.basis, /more than one/, "a paper has one category");
});

test("a blank chart request shows the strongest computed insight, with no model call", async () => {
  const outcome = await chatChartResult({ corpus: corpus(), question: BLANK_CHART_REQUEST, scopeLabel: "Test" });
  assert.ok(outcome.chart, "a chart");
  assert.equal(outcome.chart?.chartType, "insight");
  assert.equal(outcome.answer, outcome.chart?.insight.takeaway, "the words are the computed ones");
  assert.ok((outcome.chart?.papers.length ?? 0) > 0, "the papers behind it can be listed");
});

test("too few papers is said plainly", async () => {
  const small = corpus();
  small.papers = small.papers.slice(0, 2);
  const outcome = await chatChartResult({ corpus: small, question: "Papers per year", scopeLabel: "Test" });
  assert.equal(outcome.chart, null);
  assert.match(outcome.answer, /at least 3 analysed papers/);
});

test("a question the model cannot map says what can be charted", async () => {
  // No model configured here: the step reports that and offers the menu.
  const outcome = await chatChartResult({ corpus: corpus(), question: "Plot the sample sizes", scopeLabel: "Test" });
  assert.equal(outcome.chart, null);
  assert.match(outcome.answer, /theme, method, category, contribution, kind of study, aim or year/);
});

test("chat's chart step is the question engine, not the fixed charts", () => {
  const source = read("src/lib/repository-chat.ts");
  assert.match(source, /: await visualizeResult\(input, context, stepExecution\);/);
  assert.match(source, /if \(execution\?\.operation === "visualize" && plan\.intent !== "word_count"\) \{\s*const result = await visualizeResult\(input, context, execution\);/);
  assert.match(read("src/lib/chat-chart.ts"), /toolChoice: \{ type: "function", function: \{ name: "build_view" \} \}/);
  assert.match(read("src/lib/server-env.ts"), /CHAT_CHART_QUERY: "google\/gemini-3\.1-flash-lite"/);
  // A chart request read as small talk still draws the chart.
  assert.match(source, /After the chart is added: a chart request that the planner also read as\s*\/\/ small talk must draw the chart, not chat\./);
});

test("Chart mode answers with the chart alone", async () => {
  const { chartModeOperations, fallbackExecutionPlan } = await import("../src/lib/repository-chat");
  // Live: the planner added a corpus report beside the chart and 8 of 15 went to a background job.
  assert.deepEqual(chartModeOperations(["aggregate_corpus", "visualize"], false), ["visualize"]);
  assert.deepEqual(chartModeOperations(["inspect_scope", "visualize"], false), ["visualize"]);
  assert.deepEqual(chartModeOperations(["analyze_text", "visualize"], true), ["analyze_text", "visualize"], "a term-count chart keeps its counts");
  const fallback = fallbackExecutionPlan("How many papers were published each year?", true);
  assert.deepEqual(fallback.operations, ["visualize"]);
  assert.equal(fallback.operation, "visualize");
  const source = read("src/lib/repository-chat.ts");
  assert.match(source, /if \(input\.forceChart\) \{\s*operations = chartModeOperations\(operations, parsed\.data\.terms\.length > 0\);/);
});

test("the page draws a computed chart with the Adaptive tab's renderer", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /chart\.chartType === "insight" && chart\.insight \? \(\s*<ChatInsightCard/);
  const card = read("src/components/chat/ChatInsightCard.tsx");
  assert.match(card, /<InsightChart insight=\{insight\} onOpen=\{onOpen\} \/>/);
  assert.match(card, /<PaperLink paper=\{\{ paperId: paper\.id \}\}/, "a bar's papers open in place");
  // The planner's internal reason is no longer shown under a chart.
  assert.doesNotMatch(client, /chart\.planner\?\.reason \? ` - \$\{chart\.planner\.reason\}`/);
});
