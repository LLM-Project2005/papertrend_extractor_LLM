/*
 * Every view the engine can build, against every kind of collection a reader
 * can have (docs/38): 0 papers to 5,000, one theme or all unique, one year or
 * gaps, undated papers, second uploads, no research areas or eleven, long and
 * Thai names. Each view is held to the rules every chart now follows, and
 * drawn, so a view that breaks on some collection fails here rather than on
 * a reader's screen.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildInsightCorpus, type InsightCorpus } from "../src/lib/insights/corpus";
import { buildInsightReport } from "../src/lib/insights/engine";
import { ASK_DIMENSIONS, COMPARE_MIN, askVocabulary, runAskQuery, type AskQuery } from "../src/lib/insights/ask";
import { answerableQueries, queryKey } from "../src/lib/insights/suggestions";
import { allowedFacts, insightLabels, unbackedClaims } from "../src/lib/insights/check";
import { computedPlan } from "../src/lib/insights/plan";
import { MIN_PAPERS, percent } from "../src/lib/insights/stats";
import { FEW_PAPERS } from "../src/lib/insights/analyses";
import type { Insight, InsightFact, InsightReport } from "../src/lib/insights/types";
import { SHAPES, corpusInput, type CorpusShape } from "./support/chart-corpora";

void React;

interface Built {
  shape: CorpusShape;
  corpus: InsightCorpus;
  report: InsightReport;
  titles: Map<string, string>;
  ms: number;
}

const built = new Map<string, Built>();
function build(shape: CorpusShape): Built {
  const cached = built.get(shape.name);
  if (cached) return cached;
  const { input, profiles, titles } = corpusInput(shape);
  const started = performance.now();
  const corpus = buildInsightCorpus(input, profiles);
  const report = buildInsightReport(corpus);
  const result = { shape, corpus, report, titles, ms: performance.now() - started };
  built.set(shape.name, result);
  return result;
}

/** Every query the menu allows, with real values for the subjects, so no combination goes untried. */
function everyQuery(corpus: InsightCorpus): AskQuery[] {
  const vocabulary = askVocabulary(corpus, 3);
  const base = (rows: AskQuery["rows"]): AskQuery => ({ answerable: true, title: "", measure: "papers", rows, columns: null, focus: null, about: [] });
  const queries: AskQuery[] = [];
  for (const rows of ASK_DIMENSIONS) {
    queries.push(base(rows), { ...base(rows), measure: "change" });
    for (const columns of ASK_DIMENSIONS) if (columns !== rows) queries.push({ ...base(rows), columns });
    for (const dimension of ASK_DIMENSIONS) {
      const value = vocabulary[dimension][0];
      if (value) queries.push({ ...base(rows), focus: { dimension, values: [value] } });
    }
    for (const value of vocabulary[rows].slice(0, 2)) {
      queries.push({ ...base(rows), about: [value] });
      const theme = vocabulary.theme.find((name) => name !== value);
      if (theme && rows !== "theme") queries.push({ ...base(rows), about: [value], focus: { dimension: "theme", values: [theme] } });
    }
    if (vocabulary[rows].length >= 2) queries.push({ ...base(rows), about: vocabulary[rows].slice(0, 2) });
  }
  return queries;
}

/** Numbers a chart draws, as facts a takeaway may quote. */
function chartFacts(insight: Insight): InsightFact[] {
  const out: InsightFact[] = [];
  const add = (value: number | undefined, unit: InsightFact["unit"]) => {
    if (typeof value === "number" && Number.isFinite(value)) out.push({ id: `chart_${out.length}`, value, unit, text: "drawn" });
  };
  const chart = insight.chart;
  add(insight.population?.papers, "papers");
  if (chart.kind === "bars") chart.rows.forEach((row) => add(row.value, "papers"));
  if (chart.kind === "compare") {
    for (const row of chart.rows) {
      [row.left, row.right].forEach((value) => add(value, "percent"));
      [row.leftCount, row.rightCount, row.leftOf, row.rightOf].forEach((value) => add(value, "papers"));
    }
  }
  if (chart.kind === "matrix") chart.values.flat().forEach((value) => add(value, "papers"));
  if (chart.kind === "pairs") chart.rows.forEach((row) => [row.together, row.aPapers, row.bPapers].forEach((value) => add(value, "papers")));
  return out;
}

/** Each rule of docs/38, as a list of what a view breaks. */
function problems(insight: Insight, collection: Built): string[] {
  const found: string[] = [];
  const { corpus, report } = collection;
  const ids = new Set(corpus.papers.map((paper) => String(paper.id)));
  const N = corpus.papers.length;
  const json = JSON.stringify(insight);
  if (/NaN|Infinity|undefined/.test(json)) found.push("a value is not a number");
  for (const id of insight.paperIds) if (!ids.has(String(id))) found.push(`paper ${id} is not in the collection`);
  if (insight.population && (insight.population.papers < 1 || insight.population.papers > N)) found.push(`population ${insight.population.papers} of ${N}`);
  const chart = insight.chart;
  const labelsUnique = (labels: string[]) => {
    if (labels.some((label) => !label || !label.trim())) found.push("an empty label");
    if (new Set(labels).size !== labels.length) found.push("labels repeat");
  };
  switch (chart.kind) {
    case "bars": {
      labelsUnique(chart.rows.map((row) => row.label));
      if (chart.unit === "papers") {
        for (const row of chart.rows) {
          if (row.value !== row.paperIds.length) found.push(`${row.label}: ${row.value} drawn, ${row.paperIds.length} papers behind it`);
          if (!Number.isInteger(row.value) || row.value < 0) found.push(`${row.label}: ${row.value} is not a count`);
          if (insight.population && row.value > insight.population.papers) found.push(`${row.label}: ${row.value} of ${insight.population.papers}`);
        }
      }
      // The grey share lines the reader could not explain.
      for (const row of chart.rows) if (row.detail && /\d+%/.test(row.detail)) found.push(`${row.label}: a share under the bar ("${row.detail}")`);
      // A view of equal bars says nothing (shared values and years excepted: their squares count papers).
      const values = chart.rows.map((row) => row.value);
      if (chart.layout !== "columns" && insight.id === "ask" && chart.rows.length >= 2 && new Set(values).size === 1 && !chart.emphasis) found.push("every bar is the same length");
      break;
    }
    case "compare":
      labelsUnique(chart.rows.map((row) => `${row.group ?? ""}|${row.label}`));
      for (const row of chart.rows) {
        if (row.leftCount === undefined || row.rightCount === undefined || !row.leftOf || !row.rightOf) {
          found.push(`${row.label}: shares without their counts`);
          continue;
        }
        if (row.left !== percent(row.leftCount, row.leftOf)) found.push(`${row.label}: ${row.left}% is not ${row.leftCount} of ${row.leftOf}`);
        if (row.right !== percent(row.rightCount, row.rightOf)) found.push(`${row.label}: ${row.right}% is not ${row.rightCount} of ${row.rightOf}`);
        if (row.leftCount > row.leftOf || row.rightCount > row.rightOf) found.push(`${row.label}: a count above its whole`);
      }
      break;
    case "matrix":
      labelsUnique(chart.rows);
      labelsUnique(chart.cols);
      chart.values.forEach((row, r) =>
        row.forEach((value, c) => {
          if (value !== chart.paperIds[r][c].length) found.push(`cell ${r},${c}: ${value} drawn, ${chart.paperIds[r][c].length} papers`);
          if (chart.rowTotals && value > chart.rowTotals[r]) found.push(`cell ${r},${c} above its row's total`);
        })
      );
      break;
    case "table":
      for (const row of chart.rows) {
        for (const column of chart.columns) if (!(column.key in row.cells)) found.push(`row ${row.key} has no ${column.key}`);
        if (row.paperIds.length === 0) found.push(`row ${row.key} rests on no paper`);
      }
      break;
    case "stat":
      if (!chart.value.trim() || !chart.label.trim()) found.push("an empty stat");
      break;
    default:
      break;
  }
  // Every number in the sentence is drawn, stated as a fact, or a year.
  // The rules' own numbers ("at least 3 papers", "from 8 papers on") are not claims about the papers.
  const rules: InsightFact[] = [MIN_PAPERS, FEW_PAPERS, COMPARE_MIN].map((value, index) => ({ id: `rule_${index}`, value, unit: "papers", text: "a rule" }));
  const facts = [...allowedFacts(insight, report), ...chartFacts(insight), ...rules];
  const unbacked = unbackedClaims(insight.takeaway, facts, insightLabels(insight));
  if (unbacked.length) found.push(`takeaway numbers not drawn or stated: ${unbacked.map((claim) => claim.raw).join(", ")} in "${insight.takeaway}"`);
  // It draws without throwing, and without stray values.
  return found;
}

async function renderAll(insights: Insight[], titles: Map<string, string>): Promise<string[]> {
  const { default: InsightChart } = await import("../src/components/dashboard/InsightChart");
  const found: string[] = [];
  for (const insight of insights) {
    try {
      const html = renderToStaticMarkup(createElement(InsightChart, { insight, onOpen: () => undefined, paperTitles: titles }));
      if (/NaN|Infinity|>undefined</.test(html)) found.push(`${insight.id}: draws NaN or undefined`);
      for (const width of html.matchAll(/width:\s*([\d.]+)%/g)) if (Number(width[1]) > 100.0001) found.push(`${insight.id}: a bar ${width[1]}% wide`);
      if (insight.chart.kind === "bars" && insight.chart.unit === "papers" && insight.chart.layout !== "columns" && /data-units="true"/.test(html)) {
        // One square per paper, for the rows shown first.
        const squares = (html.match(/<span data-bar="true" class="block h-3\.5/g) ?? []).length;
        const expected = insight.chart.rows.slice(0, 10).reduce((sum, row) => sum + row.value, 0);
        if (squares !== expected) found.push(`${insight.id}: ${squares} squares for ${expected} papers`);
      }
    } catch (error) {
      found.push(`${insight.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return found;
}

for (const shape of SHAPES) {
  test(`every view holds the chart rules: ${shape.name}`, async () => {
    const collection = build(shape);
    const views: Insight[] = [...collection.report.insights];
    for (const query of everyQuery(collection.corpus)) {
      const answer = runAskQuery(collection.corpus, query);
      if ("insight" in answer) views.push(answer.insight);
      else assert.ok(answer.unanswerable.trim().length > 10, `${queryKey(query)}: an unanswerable view says why`);
    }
    const failures = views.flatMap((insight) => problems(insight, collection).map((problem) => `${insight.id} ${insight.question}: ${problem}`));
    failures.push(...(await renderAll(views, collection.titles)));
    assert.deepEqual(failures.slice(0, 12), [], `${failures.length} problems on "${shape.name}"`);
  });
}

test("a collection of fewer than 8 papers leads with the papers side by side, and says why", () => {
  for (const shape of SHAPES.filter((entry) => entry.papers >= 1 && entry.papers < 8)) {
    const { report } = build(shape);
    assert.equal(report.insights[0]?.id, "paper_overview", shape.name);
    assert.equal(report.insights[0].chart.kind, "table");
    if (report.insights[0].chart.kind === "table") assert.equal(report.insights[0].chart.rows.length, report.summary.papers, shape.name);
    assert.ok(report.notices.some((notice) => notice.id === "few_papers" && /side by side|shows it/.test(notice.text)), shape.name);
    const plan = computedPlan(report);
    assert.match(plan.headline, shape.papers === 1 ? /^One paper/ : /side by side/);
  }
  const empty = build(SHAPES.find((shape) => shape.papers === 0)!).report;
  assert.equal(empty.insights.length, 0);
  assert.match(empty.notices[0].text, /No analysed papers/);
});

test("suggested views never offer a chart of equal bars or a grid of 1s", () => {
  for (const shape of SHAPES.filter((entry) => entry.papers >= 3)) {
    const { corpus } = build(shape);
    for (const query of answerableQueries(corpus, 40)) {
      const answer = runAskQuery(corpus, query);
      assert.ok("insight" in answer, `${shape.name}: ${queryKey(query)} is answerable`);
      if (!("insight" in answer)) continue;
      const chart = answer.insight.chart;
      assert.notEqual(chart.kind, "table", `${shape.name}: ${queryKey(query)}`);
      assert.notEqual(chart.kind, "stat", `${shape.name}: ${queryKey(query)}`);
      if (chart.kind === "bars") assert.ok(new Set(chart.rows.map((row) => row.value)).size >= 2, `${shape.name}: ${queryKey(query)} has equal bars`);
      if (chart.kind === "matrix") assert.ok(chart.values.flat().some((value) => value >= 2), `${shape.name}: ${queryKey(query)} is a grid of 1s`);
    }
  }
});

test("a view where every value is the same is a table with a sentence, not equal bars", () => {
  const { corpus } = build(SHAPES.find((shape) => shape.themes === "unique")!);
  const answer = runAskQuery(corpus, { answerable: true, title: "", measure: "papers", rows: "theme", columns: null, focus: null });
  assert.ok("insight" in answer);
  if (!("insight" in answer)) return;
  assert.equal(answer.insight.chart.kind, "table");
  assert.match(answer.insight.takeaway, /^Each of the 12 themes appears in just one of the 6 papers selected, so none stands out\.$/);
});

test("a narrowed view is drawn against all papers, with the counts behind every share", () => {
  const { corpus } = build(SHAPES.find((shape) => shape.name.startsWith("thirty-six"))!);
  const theme = askVocabulary(corpus, 1).theme[0];
  const answer = runAskQuery(corpus, { answerable: true, title: "", measure: "papers", rows: "method", columns: null, focus: { dimension: "theme", values: [theme] } });
  assert.ok("insight" in answer);
  if (!("insight" in answer)) return;
  const chart = answer.insight.chart;
  assert.equal(chart.kind, "compare");
  if (chart.kind !== "compare") return;
  assert.equal(chart.leftLabel, `Papers on ${theme}`);
  assert.equal(chart.rightLabel, "All papers selected");
  for (const row of chart.rows) assert.equal(row.rightOf, corpus.papers.length);
});

test("5,000 papers build their insights in seconds, not minutes", () => {
  // About 1 second alone on this machine; the limit leaves room for the whole
  // suite running beside it, and still catches a step that grows out of hand.
  const big = build(SHAPES.find((shape) => shape.papers === 5000)!);
  assert.ok(big.ms < 30_000, `${Math.round(big.ms)} ms`);
  const started = performance.now();
  for (const query of everyQuery(big.corpus).slice(0, 40)) runAskQuery(big.corpus, query);
  assert.ok(performance.now() - started < 30_000, `${Math.round(performance.now() - started)} ms for 40 views`);
});

test("the same papers build the same views", () => {
  const shape = SHAPES.find((entry) => entry.name.startsWith("thirty-six"))!;
  const { input, profiles } = corpusInput(shape);
  const again = buildInsightReport(buildInsightCorpus(input, profiles));
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(build(shape).report)));
});
