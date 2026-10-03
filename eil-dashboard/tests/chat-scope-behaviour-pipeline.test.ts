/*
 * The repository chat, run rather than read (docs/32, long-term health): its
 * planner's bounds, its one answer review, its fallbacks and its answer cache.
 * runRepositoryChat runs as written against papers in PGlite under the app's
 * role (tests/support/route-harness.ts); only the model answers from a script,
 * by task name (stub-chatscope-openai.ts). Nothing leaves the process.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryExecutionPlan } from "../src/lib/repository-chat";
import type { ScriptedModelCall } from "./support/stub-chatscope-openai";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/openai.ts", new URL("./support/stub-chatscope-openai.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const PAPERS = [
  {
    run: "11111111-1111-4111-8111-111111111111",
    title: "Peer feedback in second-language writing",
    year: "2021",
    body: "This study examines peer feedback in writing classes. Students who exchanged peer feedback revised their second drafts more often, and revision quality improved.",
  },
  {
    run: "22222222-2222-4222-8222-222222222222",
    title: "Mobile apps for vocabulary learning",
    year: "2022",
    body: "Learners used a mobile app to study vocabulary every day. Retention of new words improved after eight weeks.",
  },
  {
    run: "33333333-3333-4333-8333-333333333333",
    title: "Teacher assessment literacy",
    year: "2023",
    body: "Teachers' assessment literacy was surveyed across schools. Rubric use varied widely between schools.",
  },
];

type Reply = (call: ScriptedModelCall) => unknown;

async function repository(env: Record<string, string> = {}) {
  const harness = await routeHarness(env);
  await harness.signIn(OWNER);
  const { paperIdFromRunId } = await import("../src/lib/paper-id");
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Language learning', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Studies', '${PROJECT}');
  `);
  for (const paper of PAPERS) {
    const paperId = paperIdFromRunId(paper.run);
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb)`,
      [paper.run, OWNER, FOLDER]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [paperId, OWNER, FOLDER, paper.year, paper.title]);
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, body, ingestion_run_id) VALUES ($1, $2, $3, $4, $5)`,
      [paperId, OWNER, FOLDER, paper.body, paper.run]
    );
  }
  const chat = await import("../src/lib/repository-chat");
  const cache = await import("../src/lib/answer-cache");
  cache.resetAnswerCache();
  const calls: ScriptedModelCall[] = [];
  let reply: Reply = () => null;
  globalThis.__chatScopeModel = { calls, reply: (call) => reply(call) };
  const ask = (prompt: string, extra: Partial<RepositoryChatInput> = {}) =>
    chat.runRepositoryChat({ ownerUserId: OWNER, prompt, knowledgeScope: { kind: "project", projectId: PROJECT }, projectId: PROJECT, ...extra });
  return {
    ...harness,
    ...chat,
    calls,
    ask,
    peerFeedback: paperIdFromRunId(PAPERS[0].run),
    script: (next: Reply) => void (reply = next),
    tasks: () => calls.map((call) => call.taskName),
  };
}

function plan(operation: RepositoryExecutionPlan["operation"], scopeMode: RepositoryExecutionPlan["scopeMode"], refinedQuestion: string): RepositoryExecutionPlan {
  return {
    operation,
    operations: [operation],
    scopeMode,
    refinedQuestion,
    terms: [],
    retrievalQueries: [refinedQuestion],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "prose",
    chartType: "bar",
    reason: "test",
    confidence: "high",
    source: "llm",
  };
}

const QUESTION = "What do the papers report about peer feedback?";

test("planner calls are bounded while the answer itself is not cut short", async () => {
  const { ask, calls, script, peerFeedback } = await repository();
  script((call) => {
    if (call.taskName === "CHAT_EXECUTION_PLAN") return "I think this is a focused question.";
    if (call.taskName === "CHAT_EXECUTION_PLAN_REPAIR") return plan("search_evidence", "focused", QUESTION);
    if (call.taskName === "CHAT_SYNTHESIS") {
      return { answer: `Peer feedback improved revision quality [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.9 };
    }
    return null;
  });
  const result = await ask(QUESTION);

  assert.equal(result.execution?.source, "llm", "the repaired plan was used");
  const planning = calls.filter((call) => call.taskName.startsWith("CHAT_EXECUTION_PLAN"));
  assert.deepEqual(
    planning.map((call) => [call.taskName, call.parameters.timeoutMs]),
    [["CHAT_EXECUTION_PLAN", 12_000], ["CHAT_EXECUTION_PLAN_REPAIR", 12_000]]
  );
  const synthesis = calls.find((call) => call.taskName === "CHAT_SYNTHESIS");
  assert.ok(synthesis, "the answer was written");
  assert.equal(synthesis.parameters.timeoutMs, undefined, "the answer the reader reads has no deadline of its own");
  assert.match(result.answer, /Peer feedback improved revision quality/);
});

test("a grounded answer gets one review, and its verdict on intent, completeness and language shapes the reply", async () => {
  const { ask, calls, script, peerFeedback, tasks, UNVERIFIED_ANSWER_LIMITATION, CORRECTED_ANSWER_LIMITATION, LANGUAGE_LIMITATION } = await repository();
  const draft = `Peer feedback improved revision quality [Paper ${peerFeedback}].`;
  const focused = "Focused retrieval reports relevant evidence coverage, not exhaustive corpus coverage.";
  const verdicts = [
    {
      name: "already right, rewritten for clarity",
      review: { supported: true, answersIntent: true, completeForRequest: true, languageMatched: true, correctedAnswer: `Peer feedback led to more revised second drafts [Paper ${peerFeedback}].` },
      answer: /more revised second drafts/,
      limitations: [focused],
    },
    {
      name: "does not answer what was asked",
      review: { supported: true, answersIntent: false, completeForRequest: true, languageMatched: true, correctedAnswer: "" },
      answer: /Peer feedback improved revision quality/,
      limitations: [focused, UNVERIFIED_ANSWER_LIMITATION],
    },
    {
      name: "incomplete",
      review: { supported: true, answersIntent: true, completeForRequest: false, languageMatched: true, correctedAnswer: "", reason: "It does not say how long the gains lasted." },
      answer: /Peer feedback improved revision quality/,
      limitations: [focused, "This answer may not cover the full request: It does not say how long the gains lasted."],
    },
    {
      name: "in the wrong language",
      review: { supported: true, answersIntent: true, completeForRequest: true, languageMatched: false, correctedAnswer: "" },
      answer: /Peer feedback improved revision quality/,
      limitations: [focused, LANGUAGE_LIMITATION],
    },
    {
      name: "unsupported, with a correction",
      review: { supported: false, answersIntent: true, completeForRequest: true, languageMatched: true, correctedAnswer: `Peer feedback was linked to better revisions [Paper ${peerFeedback}].` },
      answer: /linked to better revisions/,
      limitations: [focused, CORRECTED_ANSWER_LIMITATION],
    },
  ];
  for (const verdict of verdicts) {
    calls.length = 0;
    script((call) => {
      // A confidence too low to skip the review.
      if (call.taskName === "CHAT_SYNTHESIS") return { answer: draft, citedPaperIds: [peerFeedback], confidence: 0.6 };
      if (call.taskName === "CHAT_FAITHFULNESS") return { citedPaperIds: [peerFeedback], confidence: 0.9, reason: "", ...verdict.review };
      return null;
    });
    const result = await ask(QUESTION, { executionPlan: plan("search_evidence", "focused", QUESTION) });

    const reviews = calls.filter((call) => call.taskName === "CHAT_FAITHFULNESS");
    assert.equal(reviews.length, 1, `${verdict.name}: one review, however it went (${tasks().join(", ")})`);
    const shown = reviews[0].messages.map((message) => message.content).join("\n");
    assert.ok(shown.includes(QUESTION), `${verdict.name}: the review sees the question`);
    assert.ok(shown.includes(draft), `${verdict.name}: the review sees the draft`);
    assert.ok(shown.includes("revised their second drafts more often"), `${verdict.name}: the review sees the evidence`);
    assert.match(result.answer, verdict.answer, verdict.name);
    assert.deepEqual(result.limitations, verdict.limitations, verdict.name);
    assert.equal(result.diagnostics.faithfulnessChecked, true, verdict.name);
  }
});

test("a reranking failure falls back to the deterministic ranking, and the answer still arrives", async () => {
  const { ask, script, peerFeedback } = await repository();
  const { ModelCallError } = await import("../src/lib/openai");
  const { adviseOnFailure } = await import("../src/lib/model-failure");
  const answer = { answer: `Peer feedback improved revision quality [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.9 };

  script((call) => {
    if (call.taskName === "CHAT_RERANK") throw new ModelCallError(adviseOnFailure({ status: 503 }), 503);
    if (call.taskName === "CHAT_SYNTHESIS") return answer;
    return null;
  });
  const degraded = await ask(QUESTION, { executionPlan: plan("search_evidence", "focused", QUESTION) });
  assert.equal(degraded.diagnostics.rerankerSource, "fallback");
  assert.match(degraded.answer, /Peer feedback improved revision quality/);

  script((call) => {
    if (call.taskName === "CHAT_RERANK") return { paperIds: [peerFeedback], confidence: 0.8 };
    if (call.taskName === "CHAT_SYNTHESIS") return answer;
    return null;
  });
  const reranked = await ask(QUESTION, { executionPlan: plan("search_evidence", "focused", QUESTION) });
  assert.equal(reranked.diagnostics.rerankerSource, "llm", "the same question, reranked when the model answers");
});

test("an identical first question is answered from the cache, and says so", async () => {
  const { ask, calls } = await repository();
  const info = mock.method(console, "info", () => undefined);
  try {
    const first = await ask("List all the papers in this repository");
    assert.ok(calls.length > 0, "the first answer is planned by the model");
    assert.notEqual(first.diagnostics.cached, true);
    assert.match(first.answer, /Peer feedback in second-language writing/);

    calls.length = 0;
    // The history the route passes ends with the question being asked.
    const again = await ask("List all the papers in this repository", { history: [{ role: "user", content: "List all the papers in this repository" }] });
    assert.equal(calls.length, 0, "no model was called");
    assert.equal(again.diagnostics.cached, true);
    assert.equal(again.answer, first.answer);
    assert.equal(info.mock.calls.filter((call) => call.arguments[0] === "chat_cache_hit").length, 1);
  } finally {
    info.mock.restore();
  }
});

test("a follow-up is never answered from the cache", async () => {
  // A follow-up means something different depending on what came before it.
  const { ask, calls } = await repository();
  await ask("List all the papers in this repository");
  calls.length = 0;
  const followUp = await ask("List all the papers in this repository", {
    history: [
      { role: "user", content: "Which paper is about vocabulary?" },
      { role: "assistant", content: "Mobile apps for vocabulary learning." },
      { role: "user", content: "List all the papers in this repository" },
    ],
  });
  assert.notEqual(followUp.diagnostics.cached, true);
  assert.ok(calls.length > 0, "the follow-up was planned afresh");
});

test("an answer with a limitation, or one deferred to a background job, is not cached", async () => {
  const { ask, calls, script, db, peerFeedback } = await repository({
    GOOGLE_CLOUD_PROJECT_ID: "papertrend-tests",
    REPOSITORY_CHAT_TASKS_QUEUE: "chat-jobs",
    TASKS_OIDC_SERVICE_ACCOUNT: "web@papertrend-tests.iam.gserviceaccount.com",
    APP_PUBLIC_URL: "https://papertrend.test",
  });
  script((call) =>
    call.taskName === "CHAT_SYNTHESIS"
      ? { answer: `Peer feedback improved revision quality [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.9 }
      : null
  );
  // A focused answer says its coverage is not exhaustive: a limitation.
  const focused = plan("search_evidence", "focused", QUESTION);
  const first = await ask(QUESTION, { executionPlan: focused });
  assert.ok((first.limitations ?? []).length > 0);
  calls.length = 0;
  const second = await ask(QUESTION, { executionPlan: focused });
  assert.notEqual(second.diagnostics.cached, true);
  assert.ok(calls.some((call) => call.taskName === "CHAT_SYNTHESIS"), "written again, not served from the cache");

  // A report of the whole repository goes to a background job: a 202 carries a job id, not an answer.
  const original = globalThis.fetch;
  const queued: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const address = String(url);
    if (address.startsWith("http://metadata.google.internal/")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    queued.push(address);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const report = plan("aggregate_corpus", "complete", "What are the main themes across the repository?");
    const asked = { executionPlan: report, jobCallbackBaseUrl: "https://papertrend.test", sourceMessageId: "message-1" };
    const deferred = await ask("What are the main themes across the repository?", asked);
    assert.ok(deferred.jobId, "deferred to a job");
    const again = await ask("What are the main themes across the repository?", asked);
    assert.notEqual(again.diagnostics.cached, true);
    assert.equal(again.jobId, deferred.jobId, "the same question's job, queued again rather than answered from the cache");
    assert.equal(queued.length, 2);
  } finally {
    globalThis.fetch = original;
  }
  const jobs = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM repository_chat_jobs`);
  assert.equal(jobs.rows[0].count, 1);
});
