import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import { buildInsightReport } from "../src/lib/insights/engine";
import { FIXED_VIEWS, sameView } from "../src/lib/insights/fixed-views";
import { allowedFacts, extractClaims, insightLabels, unbackedClaims } from "../src/lib/insights/check";
import { checkPlan, computedPlan, buildInsightMessages } from "../src/lib/insights/plan";
import { expectedDistinct, lift, liftWithOneFewer } from "../src/lib/insights/stats";
import type { CategoryAssignmentRow, TrendRow } from "../src/types/database";
import type { InsightFact } from "../src/lib/insights/types";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/*
 * A collection with patterns planted on purpose: 30 papers, 15 before 2018 and
 * 15 after. "Writing" and "Feedback" share 5 papers; "Mixed methods" appears
 * only in the later half; "Testing" belongs to the Assessment category; the
 * rest is spread evenly so it should not surface.
 */
function fixture() {
  const trends: TrendRow[] = [];
  const categories: CategoryAssignmentRow[] = [];
  const add = (paper: number, year: number, topic: string, kind: "topic" | "method" = "topic") =>
    trends.push({
      paper_id: String(paper),
      year: String(year),
      title: `Paper ${paper} on a subject`,
      topic,
      topic_kind: kind,
      keyword: topic.toLowerCase(),
      keyword_frequency: 1,
      evidence: "",
    });
  for (let paper = 1; paper <= 30; paper += 1) {
    const year = paper <= 15 ? 2012 + (paper % 6) : 2019 + (paper % 6);
    add(paper, year, paper % 3 === 0 ? "Reading" : paper % 3 === 1 ? "Vocabulary" : "Speaking");
    if ([2, 5, 8, 11, 20, 23].includes(paper)) add(paper, year, "Writing");
    if ([2, 5, 8, 11, 20, 26].includes(paper)) add(paper, year, "Feedback");
    if ([16, 18, 21, 24, 27, 29].includes(paper)) add(paper, year, "Mixed methods", "method");
    if ([1, 4, 7, 17, 22, 28].includes(paper)) add(paper, year, "Questionnaire", "method");
    // Assessment: every fifth paper, spread evenly over the base themes.
    const assessment = paper % 5 === 0;
    if ([10, 15, 20, 25].includes(paper)) add(paper, year, "Testing");
    categories.push({
      paper_id: String(paper),
      year: String(year),
      title: `Paper ${paper} on a subject`,
      category_key: assessment ? "lae" : "eli",
      category_label: assessment ? "Assessment" : "Instruction",
      assignment_type: "single",
    });
  }
  return { trends, categoryAssignments: categories, classificationEnabled: true };
}

function report(input = fixture()) {
  return buildInsightReport(buildInsightCorpus(input));
}

test("the statistics behave as their names say", () => {
  assert.equal(lift(5, 6, 6, 30), 5 * 30 / 36);
  assert.equal(lift(0, 6, 6, 30), 0);
  assert.ok(liftWithOneFewer(5, 6, 6, 30) < lift(5, 6, 6, 30), "one fewer shared paper weakens the pairing");
  assert.equal(liftWithOneFewer(1, 6, 6, 30), 0);
  // Rarefaction: one label on every paper is always seen; drawing all papers sees every label.
  assert.equal(expectedDistinct([10], 10, 3), 1);
  assert.equal(Math.round(expectedDistinct([1, 1, 1, 1], 4, 4)), 4);
  assert.ok(expectedDistinct([1, 1, 1, 1], 4, 2) < 4);
});

test("planted patterns are found, with their numbers", () => {
  const { insights } = report();
  const byId = new Map(insights.map((insight) => [insight.id, insight]));

  const pairs = byId.get("theme_pairs");
  assert.ok(pairs, "the Writing-Feedback pairing is found");
  const fact = (id: string, name: string) => byId.get(id)!.facts.find((entry) => entry.id === name)?.value;
  assert.equal(fact("theme_pairs", "pair1_together"), 5);
  assert.equal(fact("theme_pairs", "pair1_lift"), 4.2);

  const methods = byId.get("method_shifts");
  assert.ok(methods, "mixed methods arriving in the later half is found");
  assert.match(methods!.takeaway, /Mixed methods rose from 0 of 15 papers in 2012–2017 \(0%\) to 6 of 15 in 2019–2024 \(40%\)/);

  const signatures = byId.get("category_signatures");
  assert.ok(signatures, "Testing marks out Assessment");
  assert.match(signatures!.takeaway, /^Testing marks out Assessment/);

  // Scores order the page; everything is between 0 and 1.
  for (const insight of insights) assert.ok(insight.score >= 0 && insight.score <= 1, insight.id);
  assert.deepEqual(insights.map((insight) => insight.score), [...insights.map((insight) => insight.score)].sort((a, b) => b - a));
});

test("no claim rests on fewer than 3 papers", () => {
  for (const insight of report().insights) {
    // A bridge is one paper by definition; its claim rests on the two themes' sizes.
    if (insight.id === "bridge_papers") {
      for (const fact of insight.facts.filter((entry) => entry.id !== "bridges")) assert.ok(fact.value >= 4, fact.id);
      continue;
    }
    assert.ok(insight.paperIds.length >= 3, `${insight.id} rests on ${insight.paperIds.length}`);
    if (insight.chart.kind === "pairs") for (const row of insight.chart.rows) assert.ok(row.together >= 3);
  }
  // Seven papers are too few for any pattern, and the page says so.
  const small = fixture();
  small.trends = small.trends.filter((row) => Number(row.paper_id) <= 7);
  const few = report(small);
  assert.equal(few.insights.length, 0);
  assert.deepEqual(few.notices.map((notice) => notice.id), ["few_papers"]);
});

test("a study uploaded twice is counted once", () => {
  const input = fixture();
  const copy = input.trends.filter((row) => row.paper_id === "2").map((row) => ({ ...row, paper_id: "99" }));
  input.trends.push(...copy);
  // The pipeline flags a copy by its text (duplicate_of).
  const withCopy = buildInsightReport(buildInsightCorpus(input, new Map([["99", { duplicateOf: "2" }]])));
  assert.equal(withCopy.summary.papers, 30);
  assert.equal(withCopy.summary.duplicatesCountedOnce, 1);
  assert.match(withCopy.notices.find((notice) => notice.id === "duplicates")!.text, /counted once/);
  const pairs = withCopy.insights.find((insight) => insight.id === "theme_pairs")!;
  assert.equal(pairs.facts.find((entry) => entry.id === "pair1_together")!.value, 5, "the copy does not add a sixth");
});

test("categories are not read when the repository does not classify", () => {
  const input = { ...fixture(), classificationEnabled: false };
  const ids = report(input).insights.map((insight) => insight.id);
  assert.ok(!ids.includes("category_signatures") && !ids.includes("category_mix_shift"));
});

test("no insight repeats a chart a fixed tab already draws", () => {
  for (const insight of report().insights) {
    for (const view of FIXED_VIEWS) assert.equal(sameView(insight.view, view), false, `${insight.id} repeats ${view.tab}: ${view.chart}`);
  }
});

/* --------------------------------------------------------- the checker */

const facts: InsightFact[] = [
  { id: "a", value: 5, unit: "papers", text: "papers on both" },
  { id: "b", value: 42, unit: "percent", text: "share" },
  { id: "c", value: 2.1, unit: "ratio", text: "times chance" },
  { id: "d", value: 2019, unit: "year", text: "first year" },
];

test("the checker accepts the facts and nothing else", () => {
  assert.deepEqual(unbackedClaims("Seen in 5 papers, 42% of them, 2.1 times chance, since 2019.", facts, []), []);
  assert.deepEqual(unbackedClaims("Twice as often as chance.", facts, []), [], "a ratio word close to a ratio fact");
  assert.deepEqual(unbackedClaims("Five papers share it.", facts, []), [], "a number word");
  assert.equal(unbackedClaims("Seen in 6 papers.", facts, []).length, 1);
  assert.equal(unbackedClaims("Up to 55% of them.", facts, []).length, 1);
  assert.equal(unbackedClaims("Three times as often.", facts, []).length, 1);
  assert.equal(unbackedClaims("Half of them.", facts, []).length, 1);
});

test("digits in names, titles and periods are not claims", () => {
  const labels = ["L2 Reading Comprehension", "Web 2.0 Tools"];
  assert.deepEqual(unbackedClaims("L2 Reading Comprehension and Web 2.0 Tools meet in 5 papers.", facts, labels), []);
  assert.deepEqual(unbackedClaims('Only "A 2021 study of 300 learners" joins them.', facts, []), []);
  assert.deepEqual(extractClaims("from 2011–2021", []).map((claim) => claim.value), [2011, 2021]);
});

test("every computed sentence passes its own checker", () => {
  const built = report();
  for (const insight of built.insights) {
    const allowed = allowedFacts(insight, built);
    const labels = insightLabels(insight);
    assert.deepEqual(unbackedClaims(insight.takeaway, allowed, labels).map((claim) => claim.raw), [], insight.id);
  }
  assert.equal(checkPlan({ ...computedPlan(built), cards: built.insights.map((insight) => ({ insight_id: insight.id, title: insight.question, takeaway: insight.takeaway })) }, built, "x").corrected, 0);
});

test("a model's wrong number goes back to the computed sentence", () => {
  const built = report();
  const pairs = built.insights.find((insight) => insight.id === "theme_pairs")!;
  const plan = checkPlan(
    {
      headline: "Writing and Feedback travel together",
      summary: "Across 30 papers, a few patterns stand out.",
      cards: [
        { insight_id: "theme_pairs", title: "Writing and Feedback go together in 7 papers", takeaway: "They share 7 papers." },
        { insight_id: "method_shifts", title: "Mixed methods arrived in the later half", takeaway: "Mixed methods rose from 0 to 6 papers, 40% of the later half." },
        { insight_id: "not_a_real_insight", title: "x", takeaway: "y" },
        { insight_id: "theme_pairs", title: "Duplicate", takeaway: "Duplicate" },
      ],
      caveats: ["Only 30 papers.", "Based on 31 papers."],
    },
    built,
    "google/gemini-3.1-flash-lite"
  );
  assert.equal(plan.source, "model");
  assert.deepEqual(plan.cards.map((card) => card.insightId), ["theme_pairs", "method_shifts"], "unknown and repeated cards are dropped");
  assert.equal(plan.cards[0].title, pairs.question, "a title with an unbacked number is replaced");
  assert.equal(plan.cards[0].takeaway, pairs.takeaway);
  assert.equal(plan.cards[1].takeaway, "Mixed methods rose from 0 to 6 papers, 40% of the later half.", "a sound takeaway is kept");
  assert.equal(plan.headline, "Writing and Feedback travel together");
  assert.deepEqual(plan.caveats, ["Only 30 papers."], "a caveat with an unbacked number is dropped");
  assert.equal(plan.corrected, 2, "the pairs card's title and takeaway");
});

test("a plan with no usable card is the computed plan", () => {
  const built = report();
  const plan = checkPlan({ headline: "x", summary: "y", cards: [{ insight_id: "nope", title: "a", takeaway: "b" }] }, built, "m");
  assert.equal(plan.source, "computed");
  assert.equal(checkPlan(null, built, "m").source, "computed");
});

test("the prompt is small and carries facts, not raw rows", () => {
  const built = report();
  const messages = buildInsightMessages(built, { domain: "Language education", categories: ["Instruction", "Assessment"] });
  const size = messages.reduce((total, message) => total + message.content.length, 0);
  assert.ok(size < 16_000, `prompt is ${size} characters`);
  assert.match(messages[1].content, /already_on_other_tabs/);
  assert.doesNotMatch(messages[1].content, /"evidence"|"keyword_frequency"/);
});

/* ------------------------------------------------------------- the route */

test("opening the tab never calls a model; writing up is metered and cached", () => {
  const route = read("src/app/api/workspace/insights/route.ts");
  const autoReturn = route.indexOf('if (body.mode === "auto" || report.insights.length === 0) return respond(computedPlan(report));');
  assert.ok(autoReturn > 0);
  assert.ok(autoReturn < route.indexOf("createChatCompletionResult("), "auto returns before any model call");
  assert.ok(autoReturn < route.indexOf('assertAndRecordAiUsage(user.id, "chart"'), "and before the quota is charged");
  assert.ok(route.indexOf("assertAiTokenBudget(user.id)") < route.indexOf("createChatCompletionResult("));
  assert.match(route, /withAiTokenUsageTracking\(/);
  assert.match(route, /persistAiTokenUsage\(user\.id, usage\)/, "tokens count toward the daily budget");
  assert.match(route, /timeoutMs: 25_000/);
  assert.match(route, /writeCachedPlan\(user\.id, built, body\.projectId, plan\)/);
  const server = read("src/lib/insights/server.ts");
  assert.match(server, /return `\$\{INSIGHTS_PROMPT_VERSION\}:\$\{dataHash\}`;/, "a cached plan is for exactly these papers and this prompt");
  assert.match(server, /scope_type = 'custom' AND scope_key = \$2 AND version_hash = \$3/);
});

test("the editor runs on Gemini 3.1 Flash-Lite unless configured otherwise", () => {
  assert.match(read("src/lib/server-env.ts"), /ADAPTIVE_INSIGHTS: "google\/gemini-3\.1-flash-lite",/);
  assert.match(read("src/app/api/workspace/insights/route.ts"), /const TASK = "ADAPTIVE_INSIGHTS";/);
});

test("the old planner and its hidden Library call are gone", () => {
  assert.doesNotMatch(read("src/components/admin/AdminImportClient.tsx"), /visualization-plan/);
  assert.doesNotMatch(read("src/components/DashboardClient.tsx"), /visualization-plan|generateAdaptiveCharts/);
  for (const path of ["src/lib/visualization-planner.ts", "src/lib/visualization-plan.ts", "src/app/api/visualization-plan/route.ts"]) {
    assert.throws(() => read(path), `${path} still exists`);
  }
});
