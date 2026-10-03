import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import { buildInsightReport } from "../src/lib/insights/engine";
import { FIXED_VIEWS, sameView } from "../src/lib/insights/fixed-views";
import { allowedFacts, claimsCause, dropFiller, extractClaims, insightLabels, scrubLoadedWords, unbackedClaims } from "../src/lib/insights/check";
import { checkPlan, computedPlan, buildInsightMessages, INSIGHTS_PROMPT_VERSION } from "../src/lib/insights/plan";
import { expectedDistinct, lift, liftWithOneFewer } from "../src/lib/insights/stats";
import { paperIdFromRunId } from "../src/lib/paper-id";
import type { CategoryAssignmentRow, TrendRow } from "../src/types/database";
import type { Insight, InsightFact } from "../src/lib/insights/types";
import { routeHarness } from "./support/route-harness";

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

test("no claim of significance or cause survives", () => {
  assert.equal(scrubLoadedWords("This suggests a significant decline."), "This suggests a decline.");
  assert.equal(scrubLoadedWords("It declined significantly, then rose."), "It declined, then rose.");
  assert.equal(scrubLoadedWords("A statistically significant rise."), "A rise.");
  assert.equal(claimsCause("Mixed methods leads to better designs."), true);
  assert.equal(claimsCause("The fall is due to fewer grants."), true);
  assert.equal(claimsCause("Writing and Feedback appear together."), false);
  assert.equal(claimsCause("Drives of Motivation rose.", ["Drives of Motivation"]), false, "a name is not a claim");
  const built = report();
  const plan = checkPlan(
    { headline: "Mixed methods arrived", summary: "Patterns in 30 papers.", cards: [{ insight_id: "method_shifts", title: "Mixed methods arrived", takeaway: "Mixed methods rose from 0 to 6 papers, which led to better designs." }] },
    built,
    "m"
  );
  const insight = built.insights.find((entry) => entry.id === "method_shifts")!;
  assert.equal(plan.cards[0].takeaway, insight.takeaway, "a causal takeaway goes back to the computed sentence");
  assert.deepEqual(plan.checks?.map((check) => check.reason), ["claims a cause"]);
});

test("a theme wholly inside a related one is not sold as a pairing", () => {
  const input = fixture();
  // Every "Genre writing" paper is also a "Writing" paper: a part and its whole.
  for (const paper of [2, 5, 8]) {
    input.trends.push({ ...input.trends.find((row) => row.paper_id === String(paper))!, topic: "Genre writing", keyword: "genre" });
  }
  // Every "Peer review" paper is on "Feedback" too, but the names are different subjects.
  for (const paper of [5, 8, 11]) {
    input.trends.push({ ...input.trends.find((row) => row.paper_id === String(paper))!, topic: "Peer review", keyword: "peer review" });
  }
  const pairs = report(input).insights.find((entry) => entry.id === "theme_pairs")!;
  const rows = pairs.chart.kind === "pairs" ? pairs.chart.rows : [];
  assert.equal(rows.some((row) => row.a === "Genre writing" && row.b === "Writing"), false, "the part and its whole is dropped");
  assert.ok(rows.some((row) => row.a === "Peer review"), "a nested pair of different subjects stays");
});

test("abbreviations count as the words they stand for", () => {
  const input = fixture();
  for (const paper of [2, 5, 8]) {
    input.trends.push({ ...input.trends.find((row) => row.paper_id === String(paper))!, topic: "L2 Writing Process", keyword: "l2" });
  }
  for (const paper of [2, 5, 8, 11, 14]) {
    input.trends.push({ ...input.trends.find((row) => row.paper_id === String(paper))!, topic: "Second Language Writing", keyword: "slw" });
  }
  const pairs = report(input).insights.find((entry) => entry.id === "theme_pairs");
  const rows = pairs && pairs.chart.kind === "pairs" ? pairs.chart.rows : [];
  assert.equal(rows.some((row) => row.a === "L2 Writing Process" && row.b === "Second Language Writing"), false);
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

/*
 * The routes run against PGlite under the app's role (tests/support/route-harness.ts),
 * with the fixture's papers stored as the analysis stores them. The model is
 * the real client with fetch replaced: it answers here, and no request leaves.
 */
const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const MODEL_URL = "https://openrouter.ai/api/v1/chat/completions";
const runOf = (paper: string) => `${Number(paper).toString(16).padStart(8, "0")}-e5f6-4a7b-8c9d-0e1f2a3b4c5d`;

async function storedRepository() {
  const harness = await routeHarness({
    OPENAI_API_KEY: "route-test-key",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    MODEL_TASK_ADAPTIVE_INSIGHTS: undefined,
    AI_DAILY_TOKEN_LIMIT: undefined,
  });
  const { db } = harness;
  const owner = await harness.signIn(OWNER);
  await db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{"classificationEnabled": false}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'A', '${PROJECT}');
  `);
  const byPaper = new Map<string, TrendRow[]>();
  for (const row of fixture().trends) byPaper.set(row.paper_id, [...(byPaper.get(row.paper_id) ?? []), row]);
  for (const [paper, rows] of byPaper) {
    const run = runOf(paper);
    const id = paperIdFromRunId(run);
    await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status) VALUES ($1, $2, $3, 'upload', 'succeeded')`, [run, OWNER, FOLDER]);
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [id, OWNER, FOLDER, rows[0].year, rows[0].title]);
    await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id) VALUES ($1, $2, $3, $4)`, [id, OWNER, FOLDER, run]);
    for (const row of rows) {
      await db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, $4, $5)`, [id, OWNER, FOLDER, row.topic, row.keyword]);
    }
  }
  const usage = async () =>
    (
      await db.query<{ usage_kind: string; units: number; metadata: Record<string, unknown> }>(
        `SELECT usage_kind, units, metadata FROM ai_usage_events WHERE owner_user_id = $1 ORDER BY created_at, usage_kind`,
        [OWNER]
      )
    ).rows;
  return { ...harness, owner, usage };
}

/** The model's endpoint, answered here; any other address fails the test. */
function stubModel(reply: (body: Record<string, unknown>) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const timeouts: number[] = [];
  const original = { fetch: globalThis.fetch, timeout: AbortSignal.timeout };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) !== MODEL_URL) throw new Error(`Unexpected request to ${String(url)}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return new Response(JSON.stringify(reply(body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  AbortSignal.timeout = (milliseconds: number) => {
    timeouts.push(milliseconds);
    return original.timeout.call(AbortSignal, milliseconds);
  };
  return {
    calls,
    timeouts,
    restore() {
      globalThis.fetch = original.fetch;
      AbortSignal.timeout = original.timeout;
    },
  };
}

const toolReply = (name: string, args: unknown) => ({
  model: "google/gemini-3.1-flash-lite",
  usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200 },
  choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
});

const fixtureYears = () => [...new Set(fixture().trends.map((row) => row.year))].sort();

test("opening the tab never calls a model; writing up is metered, bounded and cached", async () => {
  const { db, request, owner, usage } = await storedRepository();
  const { POST } = await import("../src/app/api/workspace/insights/route");
  const model = stubModel(() =>
    toolReply("write_insights_page", {
      headline: "Writing and Feedback travel together",
      summary: "Across 30 papers, a few patterns stand out.",
      cards: [{ insight_id: "theme_pairs", title: "Writing and Feedback go together", takeaway: "They share 7 papers." }],
      caveats: [],
    })
  );
  const open = async (body: Record<string, unknown> = {}) => {
    const response = await POST(request("/api/workspace/insights", { headers: owner, body: { projectId: PROJECT, fresh: true, ...body } }));
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const opened = await open();
    assert.equal(opened.plan.source, "computed");
    const pairs = (opened.report.insights as Insight[]).find((insight) => insight.id === "theme_pairs");
    assert.ok(pairs, "the stored papers give the planted pairing");
    assert.equal(model.calls.length, 0, "opening the tab calls no model");
    assert.deepEqual(await usage(), [], "and charges nothing");

    const written = await open({ mode: "write" });
    assert.equal(model.calls.length, 1);
    assert.equal(model.calls[0].model, "google/gemini-3.1-flash-lite", "the editor runs on Gemini 3.1 Flash-Lite");
    assert.deepEqual(model.timeouts, [25_000], "and is given 25 seconds");
    assert.equal(written.plan.source, "model");
    assert.equal(written.cached, false);
    assert.equal(written.plan.cards[0].takeaway, pairs!.takeaway, "the model's wrong number went back to the computed sentence");
    assert.ok(written.plan.corrected >= 1);
    assert.equal("checks" in written.plan, false, "the checker's notes stay in the log");
    const charged = await usage();
    assert.deepEqual(
      charged.map((row) => [row.usage_kind, row.metadata.route ?? row.metadata.source]),
      [["chart", "insights"], ["chat_message", "insights"]],
      "one write-up against the daily quota, and its tokens against the daily limits"
    );
    assert.equal(charged[1].units, 1200);
    assert.equal(charged[1].metadata.metric, "tokens");

    const again = await open({ mode: "write" });
    assert.equal(again.cached, true, "the write-up is cached for these papers");
    assert.deepEqual(again.plan, written.plan);
    assert.equal((await open()).cached, true, "and shown when the tab is opened again");
    assert.equal((await open({ selectedYears: fixtureYears() })).cached, true, "every year selected is the same papers");
    assert.equal(model.calls.length, 1, "none of which calls the model");
    assert.equal((await usage()).length, 2, "or charges again");

    const fewer = await open({ selectedYears: fixtureYears().slice(1) });
    assert.equal(fewer.cached, false, "other papers have no write-up yet");
    assert.equal(fewer.plan.source, "computed");

    const stored = await db.query<{ version_hash: string }>(`SELECT version_hash FROM workspace_analytics_cache WHERE scope_key LIKE 'insights:%'`);
    assert.equal(stored.rows.length, 1);
    assert.ok(stored.rows[0].version_hash.startsWith(`${INSIGHTS_PROMPT_VERSION}:`), "stored under this prompt");
    await db.query(`UPDATE workspace_analytics_cache SET version_hash = replace(version_hash, $1, 'an-older-prompt') WHERE scope_key LIKE 'insights:%'`, [INSIGHTS_PROMPT_VERSION]);
    assert.equal((await open()).cached, false, "a write-up made under another prompt is not shown");
  } finally {
    model.restore();
  }
});

test("a spent token budget writes nothing up, and the editor's model can be configured", async () => {
  const { db, request, owner, usage } = await storedRepository();
  const { POST } = await import("../src/app/api/workspace/insights/route");
  const model = stubModel(() => toolReply("write_insights_page", { headline: "x", summary: "y", cards: [], caveats: [] }));
  const write = () => POST(request("/api/workspace/insights", { headers: owner, body: { projectId: PROJECT, fresh: true, mode: "write", refresh: true } }));
  try {
    await db.query(
      `INSERT INTO ai_usage_events (owner_user_id, usage_kind, units, metadata) VALUES ($1, 'chat_message', 1000000, '{"metric": "tokens"}'::jsonb)`,
      [OWNER]
    );
    const refused = await (await write()).json();
    assert.equal(refused.plan.source, "computed");
    assert.match(refused.notice, /Daily chat token limit reached/);
    assert.equal(model.calls.length, 0, "no model is called");
    assert.equal((await usage()).length, 1, "and no write-up is counted");

    await db.exec(`DELETE FROM ai_usage_events`);
    process.env.MODEL_TASK_ADAPTIVE_INSIGHTS = "openai/gpt-5-mini";
    await write();
    assert.equal(model.calls[0].model, "openai/gpt-5-mini");
  } finally {
    delete process.env.MODEL_TASK_ADAPTIVE_INSIGHTS;
    model.restore();
  }
});

test("the old planner and its hidden Library call are gone", async () => {
  // Only an effect in these two large client components could call it, and
  // effects need a browser, so the wording is checked.
  assert.doesNotMatch(read("src/components/admin/AdminImportClient.tsx"), /visualization-plan/);
  assert.doesNotMatch(read("src/components/DashboardClient.tsx"), /visualization-plan|generateAdaptiveCharts/);
  for (const path of ["../src/lib/visualization-planner", "../src/lib/visualization-plan", "../src/app/api/visualization-plan/route"]) {
    await assert.rejects(import(path), `${path} still loads`);
  }
});

/* ------------------------------------------------------ asking a question */

test("a question becomes a computed view; the model's words never reach the page", async () => {
  const { runAskQuery, parseAskQuery, askVocabulary } = await import("../src/lib/insights/ask");
  const corpus = buildInsightCorpus(fixture());
  const vocabulary = askVocabulary(corpus);
  assert.ok(vocabulary.method.includes("Mixed methods") && vocabulary.theme.includes("Writing"));

  // Methods by theme: a cross, with the strongest pairing computed.
  const cross = runAskQuery(corpus, { answerable: true, title: "IGNORED 99 words from a model", measure: "papers", rows: "theme", columns: "method" });
  assert.ok("insight" in cross);
  if ("insight" in cross) {
    assert.equal(cross.insight.chart.kind, "matrix");
    assert.equal(cross.insight.question, "Themes by method", "the title is built in code");
    assert.doesNotMatch(JSON.stringify(cross.insight), /IGNORED|99 words/);
  }

  // Narrowed to one theme, forgiving case: 6 papers on Writing.
  const focused = runAskQuery(corpus, { answerable: true, title: "", measure: "papers", rows: "category", focus: { dimension: "theme", values: ["writing"] } });
  assert.ok("insight" in focused && focused.insight.facts.find((fact) => fact.id === "scope")?.value === 6);

  // Change: mixed methods arrives in the later half.
  const change = runAskQuery(corpus, { answerable: true, title: "", measure: "change", rows: "method" });
  assert.ok("insight" in change);
  if ("insight" in change && change.insight.chart.kind === "compare") {
    assert.equal(change.insight.chart.rows.find((row) => row.label === "Mixed methods")?.tag, "gaining");
  }

  // Refusals are sentences, not guesses.
  const refused = runAskQuery(corpus, { answerable: false, reason: "Authors are not recorded.", title: "", measure: "papers", rows: "theme" });
  assert.deepEqual(refused, { unanswerable: "Authors are not recorded." });
  assert.ok("unanswerable" in runAskQuery(corpus, { answerable: true, title: "", measure: "papers", rows: "theme", focus: { dimension: "theme", values: ["Astrophysics"] } }));

  // Parsing forgives the model's shape and never trusts an unknown dimension.
  assert.equal(parseAskQuery({ answerable: true, rows: "authors", measure: "papers", title: "x" }), null);
  assert.equal(parseAskQuery({ answerable: true, rows: "theme", columns: "none", measure: "papers", title: "x" })?.columns, null);
});

test("asking is metered like writing up, and returns only computed output", async () => {
  const { db, request, owner, usage } = await storedRepository();
  const { POST } = await import("../src/app/api/workspace/insights/ask/route");
  const { buildInsightsForRequest } = await import("../src/lib/insights/server");
  const { parseAskQuery, runAskQuery } = await import("../src/lib/insights/ask");
  const view = { answerable: true, title: "IGNORED 99 words from a model", measure: "papers", rows: "theme", columns: "none" };
  const model = stubModel(() => toolReply("build_view", view));
  const ask = (question: unknown) => POST(request("/api/workspace/insights/ask", { headers: owner, body: { projectId: PROJECT, question } }));
  try {
    for (const question of ["ab", "  ab  ", "x".repeat(301), 42]) {
      const response = await ask(question);
      assert.equal(response.status, 400, JSON.stringify(question).slice(0, 40));
      assert.deepEqual(await response.json(), { error: "Ask a question of 3 to 300 characters." });
    }
    assert.equal(model.calls.length, 0, "a malformed question reaches no model");

    const response = await ask("  Which themes are most common?  ");
    assert.equal(response.status, 200);
    const answer = await response.json();
    const built = await buildInsightsForRequest({ ownerUserId: OWNER, projectId: PROJECT, selectedYears: [], selectedTracks: [], searchQuery: "", fresh: true });
    assert.deepEqual(answer, JSON.parse(JSON.stringify(runAskQuery(built.corpus, parseAskQuery(view)!))), "the view computed from the model's query, and nothing else");
    assert.doesNotMatch(JSON.stringify(answer), /IGNORED|99 words/);
    assert.equal(model.calls[0].model, "google/gemini-3.1-flash-lite");
    assert.deepEqual(model.timeouts, [20_000]);
    assert.deepEqual(
      (await usage()).map((row) => [row.usage_kind, row.metadata.route ?? row.metadata.source]),
      [["chart", "insights-ask"], ["chat_message", "insights-ask"]]
    );

    await db.query(
      `INSERT INTO ai_usage_events (owner_user_id, usage_kind, units, metadata) VALUES ($1, 'chat_message', 1000000, '{"metric": "tokens"}'::jsonb)`,
      [OWNER]
    );
    const refused = await ask("Which themes are most common?");
    assert.equal(refused.status, 429, "a spent budget is refused before the model is asked");
    assert.equal(model.calls.length, 1);
  } finally {
    model.restore();
  }
});

test("a narrowed question is answered against all papers, about the value asked", async () => {
  const { runAskQuery, parseAskQuery } = await import("../src/lib/insights/ask");
  const corpus = buildInsightCorpus(fixture());
  // "Is mixed methods more common in writing papers?" None of the 6 Writing papers uses it; 6 of all 30 do.
  const query = parseAskQuery({ answerable: true, title: "t", measure: "papers", rows: "method", columns: "none", focus_dimension: "theme", focus_values: ["Writing"], about_values: ["Mixed methods"] });
  assert.ok(query && query.focus?.values[0] === "Writing" && query.about?.[0] === "Mixed methods");
  const answer = runAskQuery(corpus, query!);
  assert.ok("insight" in answer);
  if ("insight" in answer) {
    assert.equal(answer.insight.takeaway, "None of the 6 papers on Writing has Mixed methods, against 20% of all 30 papers selected.");
    assert.equal(answer.insight.facts.find((fact) => fact.id === "about_overall")?.value, 20);
  }
  const feedback = runAskQuery(corpus, { ...query!, rows: "theme", about: ["feedback"] });
  assert.ok("insight" in feedback);
  if ("insight" in feedback) {
    assert.equal(feedback.insight.takeaway, "Feedback appears in 5 of the 6 papers on Writing (83%), against 20% of all 30 papers selected.");
  }
});

test("values tied at the top are named together", async () => {
  const { runAskQuery } = await import("../src/lib/insights/ask");
  const corpus = buildInsightCorpus(fixture());
  // Reading, Vocabulary and Speaking each have 10 of the 30 papers.
  const answer = runAskQuery(corpus, { answerable: true, title: "", measure: "papers", rows: "theme" });
  assert.ok("insight" in answer);
  if ("insight" in answer) assert.match(answer.insight.takeaway, /the most common themes are Reading, Speaking and Vocabulary, in 10 each \(33%\)\./);
});

test("a closing sentence that only restates the numbers is dropped", () => {
  // Seen in real write-ups on the pilot.
  assert.equal(
    dropFiller("Language Assessment & Evaluation fell from 24% to 5%. This shift highlights a changing focus within the field over time."),
    "Language Assessment & Evaluation fell from 24% to 5%."
  );
  assert.equal(
    dropFiller("They appear together in 3 papers. This suggests these topics are closely linked in the literature."),
    "They appear together in 3 papers."
  );
  assert.equal(
    dropFiller("Mixed methods is used in 100% of papers on reading, indicating a strong methodological preference for this theme."),
    "Mixed methods is used in 100% of papers on reading."
  );
  // A second sentence that names something, or carries a number, stays.
  const labels = ["Second Language Acquisition Theory"];
  const kept = "Dynamic assessment is new in 2024. Second Language Acquisition Theory remains a consistent focus across 6 different years.";
  assert.equal(dropFiller(kept, labels), kept);
  assert.equal(dropFiller("Rose to 32%. This coincides with the rise shown on card 2."), "Rose to 32%. This coincides with the rise shown on card 2.");
});

test("the model's filler is removed before the page shows it", () => {
  const built = report();
  const plan = checkPlan(
    { headline: "Mixed methods arrived", summary: "Patterns in 30 papers.", cards: [{ insight_id: "method_shifts", title: "Mixed methods arrived", takeaway: "Mixed methods rose from 0 to 6 papers. This shift reflects a growing preference in the field." }] },
    built,
    "m"
  );
  assert.equal(plan.cards[0].takeaway, "Mixed methods rose from 0 to 6 papers.");
});

test("a sub-topic wholly inside a theme that shares a word with it is not a pairing", () => {
  const input = fixture();
  // "L2 Feedback Processing" sits wholly inside "Second Language Feedback"-style
  // themes; here: every paper on "Written Feedback" is on "Feedback".
  for (const paper of [2, 5, 8]) {
    input.trends.push({ ...input.trends.find((row) => row.paper_id === String(paper))!, topic: "Written Feedback Studies", keyword: "written" });
  }
  const pairs = report(input).insights.find((entry) => entry.id === "theme_pairs");
  const rows = pairs && pairs.chart.kind === "pairs" ? pairs.chart.rows : [];
  assert.equal(rows.some((row) => row.a === "Written Feedback Studies" && row.b === "Feedback"), false, "a part of Feedback, by name");
  assert.equal(dropFiller("They meet in 5 papers, 4.2 times as often as chance."), "They meet in 5 papers, 4.2 times as often as chance.", "a decimal is not a sentence end");
});
