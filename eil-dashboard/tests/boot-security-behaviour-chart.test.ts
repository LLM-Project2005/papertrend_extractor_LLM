/*
 * Chat's chart step, run rather than read (docs/32, long-term health): it
 * replaces text assertions in chat-chart. The model client (openai.ts) runs as
 * written; only the network is replaced, by a fetch that records each request
 * and answers it as OpenRouter would. Papers are in PGlite under the app's role
 * (tests/support/route-harness.ts), which every test starts first so the
 * modules load through it. Nothing leaves the process.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import type { RepositoryContext, RepositoryExecutionPlan } from "../src/lib/repository-chat";
import type { TrendRow } from "../src/types/database";
import { routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";

interface ModelRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function: { name: string } }>;
  tool_choice?: unknown;
}

/** The model, as OpenRouter: each request recorded, each answered by `reply`. */
function model(reply: (request: ModelRequest) => { content?: string; toolCall?: { name: string; arguments: unknown } }) {
  const requests: ModelRequest[] = [];
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
  delete process.env.MODEL_TASK_CHAT_CHART_QUERY;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "only the model is called");
    const request = JSON.parse(String(init?.body)) as ModelRequest;
    requests.push(request);
    const answer = reply(request);
    const message = {
      content: answer.content ?? null,
      tool_calls: answer.toolCall
        ? [{ id: "call-1", type: "function", function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.arguments) } }]
        : undefined,
    };
    return new Response(JSON.stringify({ model: request.model, choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

const PAPERS_PER_YEAR = { rows: "year", measure: "papers", answerable: true, title: "Papers per year" };
const isChartQuery = (request: ModelRequest) => request.tools?.some((tool) => tool.function.name === "build_view") ?? false;
const isPlanner = (request: ModelRequest) => /Interpret the request semantically/.test(request.messages[0]?.content ?? "");

function plan(operations: RepositoryExecutionPlan["operations"], terms: string[] = []) {
  return {
    operation: operations[0],
    operations,
    scopeMode: "complete",
    refinedQuestion: "Papers per year",
    terms,
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "chart",
    chartType: "bar",
    reason: "test",
    confidence: "high",
  };
}

test("a chart question becomes one forced build_view call on the chart model, and the chart is computed from it", async () => {
  await routeHarness();
  const requests = model((request) => (isChartQuery(request) ? { toolCall: { name: "build_view", arguments: PAPERS_PER_YEAR } } : {}));
  const { chatChartResult } = await import("../src/lib/chat-chart");
  const trends = Array.from({ length: 9 }, (_, i) => ({ paper_id: String(i + 1), year: String(2018 + (i % 4)), title: `Paper ${i + 1}`, topic: i % 2 ? "Reading" : "Writing", topic_kind: "topic", keyword: "k", keyword_frequency: 1, evidence: "" }) as TrendRow);
  const corpus = buildInsightCorpus({ trends, categoryAssignments: [], classificationEnabled: false });
  const outcome = await chatChartResult({ corpus, question: "How many papers came out each year?", scopeLabel: "Test" });

  assert.equal(requests.length, 1, "one call");
  assert.equal(requests[0].model, "google/gemini-3.1-flash-lite", "the chart model");
  assert.deepEqual(requests[0].tool_choice, { type: "function", function: { name: "build_view" } }, "the view is always built through the tool");
  assert.deepEqual(requests[0].tools?.map((tool) => tool.function.name), ["build_view"]);
  assert.equal(outcome.chart?.chartType, "insight");
  assert.equal(outcome.chart?.insight.question, "Papers per year");
  assert.deepEqual(outcome.query?.rows, "year");
  assert.equal(outcome.answer, outcome.chart?.insight.takeaway, "the words are the computed ones");
});

test("in chart mode the answer is the chart alone, and a chart request read as small talk still draws it", async () => {
  await routeHarness();
  let planned = plan(["aggregate_corpus", "visualize"]);
  model((request) => (isPlanner(request) ? { content: JSON.stringify(planned) } : {}));
  const { planRepositoryExecution } = await import("../src/lib/repository-chat");
  const context = {
    scopeSnapshot: { kind: "project", label: "Test", projectId: PROJECT, projectName: "Test", folderId: null, folderName: null, selectedRunCount: 0, eligiblePaperCount: 9 },
    projects: [],
    runStats: {},
    papers: [],
  } as unknown as RepositoryContext;
  const ask = (prompt: string, forceChart: boolean) => planRepositoryExecution({ ownerUserId: OWNER, prompt, forceChart }, context);

  // Live: the planner added a corpus report beside the chart, and the answer went to a background job.
  assert.deepEqual((await ask("How many papers per year?", true)).operations, ["visualize"]);
  planned = plan(["analyze_text", "visualize"], ["feedback"]);
  assert.deepEqual((await ask('Chart how often "feedback" appears', true)).operations, ["analyze_text", "visualize"], "a term-count chart keeps its counts");
  planned = plan(["converse"]);
  const smallTalk = await ask("Plot the papers per year please", false);
  assert.deepEqual(smallTalk.operations, ["visualize"], "the chart is drawn, not chatted about");
  assert.equal(smallTalk.operation, "visualize");
  assert.deepEqual((await ask("Hello there", false)).operations, ["converse"], "small talk without a chart stays small talk");
});

test("in chat, a chart request is drawn by the question engine from the repository's papers", async () => {
  const harness = await routeHarness({ CHAT_FAST_MODEL: "off" });
  await harness.signIn(OWNER);
  const { paperIdFromRunId } = await import("../src/lib/paper-id");
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Language learning', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Studies', '${PROJECT}');
  `);
  for (let i = 1; i <= 6; i += 1) {
    const run = `${i}${i}${i}${i}${i}${i}${i}${i}-1111-4111-8111-111111111111`;
    const paperId = paperIdFromRunId(run);
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload) VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb)`,
      [run, OWNER, FOLDER]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [paperId, OWNER, FOLDER, String(2018 + (i % 3)), `Paper ${i}`]);
    await harness.db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, body, ingestion_run_id) VALUES ($1, $2, $3, 'A study of feedback in writing classes.', $4)`, [paperId, OWNER, FOLDER, run]);
    await harness.db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword, keyword_frequency) VALUES ($1, $2, $3, $4, 'feedback', 2)`, [paperId, OWNER, FOLDER, i % 2 ? "Writing" : "Reading"]);
  }
  const requests = model((request) => {
    if (isPlanner(request)) return { content: JSON.stringify(plan(["visualize"])) };
    if (isChartQuery(request)) return { toolCall: { name: "build_view", arguments: PAPERS_PER_YEAR } };
    return {};
  });
  const { runRepositoryChat } = await import("../src/lib/repository-chat");
  const { resetAnswerCache } = await import("../src/lib/answer-cache");
  resetAnswerCache();
  const result = await runRepositoryChat({ ownerUserId: OWNER, prompt: "Show the papers per year as a chart", projectId: PROJECT, knowledgeScope: { kind: "project", projectId: PROJECT } });
  assert.equal(requests.filter(isChartQuery).length, 1, "the chart step asked the question engine");
  const chart = result.charts[0] as { chartType?: string; insight?: { question: string; chart: { kind: string; rows?: Array<{ label: string; value: number }> } } };
  assert.equal(chart?.chartType, "insight");
  assert.equal(chart?.insight?.question, "Papers per year");
  assert.deepEqual(chart?.insight?.chart.rows?.map((row) => [row.label, row.value]), [["2018", 2], ["2019", 2], ["2020", 2]]);
});
