/*
 * Background repository answers, run rather than read (docs/32, long-term
 * health): a job and its placeholder are made once, the answer replaces the
 * placeholder in place, a claim is kept by its heartbeat and taken over when
 * silent, and the task is queued once by name. The job functions and routes run
 * against PGlite under the app's role (tests/support/route-harness.ts).
 * The planner's deadlines are run in chat-scope-behaviour-pipeline.test.ts, and
 * a reader leaving in chat-scope-behaviour-route.test.ts and chat-reliability.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryChatResult, RepositoryExecutionPlan } from "../src/lib/repository-chat";
import { params, routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a9";
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const PLAN: RepositoryExecutionPlan = {
  operation: "aggregate_corpus",
  operations: ["aggregate_corpus"],
  scopeMode: "complete",
  refinedQuestion: "What are the main themes across the repository?",
  terms: [],
  retrievalQueries: [],
  evidenceNeeds: [],
  requestedFields: [],
  answerLanguage: "English",
  outputFormat: "report",
  chartType: "bar",
  reason: "test",
  confidence: "high",
  source: "llm",
};

async function workspace() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now()),
      ('${OTHER_PROJECT}', '00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
  `);
  const jobs = await import("../src/lib/repository-chat-jobs");
  const { getChatRepository } = await import("../src/lib/chat-repository");
  const chat = getChatRepository();
  const thread = await chat.createThread({ ownerUserId: OWNER, mode: "normal", title: "Themes" });
  const question = await chat.appendMessage({ threadId: thread.id, ownerUserId: OWNER, role: "user", content: PLAN.refinedQuestion });
  const input: RepositoryChatInput = {
    ownerUserId: OWNER,
    threadId: thread.id,
    projectId: PROJECT,
    knowledgeScope: { kind: "project", projectId: PROJECT },
    prompt: PLAN.refinedQuestion,
    sourceMessageId: question.id,
  };
  const assistantMessages = async () =>
    (
      await harness.db.query<{ id: string; message_kind: string; content: string; metadata: Record<string, unknown> }>(
        `SELECT id, message_kind, content, metadata FROM workspace_messages WHERE thread_id = $1 AND role = 'assistant' ORDER BY created_at`,
        [thread.id]
      )
    ).rows;
  const job = async (id: string) =>
    (await harness.db.query<{ status: string; result_text: string | null; error_message: string | null; progress_current: number; progress_total: number; done: boolean }>(
      `SELECT status, result_text, error_message, progress_current, progress_total, completed_at IS NOT NULL AS done FROM repository_chat_jobs WHERE id = $1`,
      [id]
    )).rows[0];
  return { ...harness, ...jobs, owner, other, thread, question, input, assistantMessages, job };
}

function result(answer: string): RepositoryChatResult {
  return {
    handled: true,
    answer,
    citations: [],
    charts: [],
    plan: { intent: "topic_summary", refinedQuestion: answer, terms: [], retrievalQueries: [], evidenceNeeds: [], answerLanguage: "English", retrievalMode: "exhaustive", needsChart: false, chartType: "bar", reason: "", confidence: "high", source: "llm" },
    coverage: { eligiblePapers: 3, processedPapers: 3, returnedPapers: 3, complete: true, scopeLabel: "Mine repository" },
    limitations: [],
    scopeSnapshot: { kind: "project", label: "Mine repository", projectId: PROJECT, projectName: "Mine", folderId: null, folderName: null, selectedRunCount: 0, eligiblePaperCount: 3 },
    diagnostics: { projectId: PROJECT, folderId: null, selectedRunCount: 0, paperCount: 3, versionHash: "v1", scopeLabel: "Mine repository" },
  };
}

test("a question's job is made once, with one placeholder answer, however often it is asked for", async () => {
  const { db, createRepositoryChatJob, input, assistantMessages, job } = await workspace();
  const first = await createRepositoryChatJob(input, PLAN, 3);
  const retried = await createRepositoryChatJob(input, PLAN, 3);
  assert.equal(retried, first, "the same question from the same message is the same job");
  assert.deepEqual(await job(first), { status: "queued", result_text: null, error_message: null, progress_current: 0, progress_total: 3, done: false });

  const placeholders = await assistantMessages();
  assert.equal(placeholders.length, 1, "one placeholder, not one per attempt");
  assert.equal(placeholders[0].message_kind, "status");
  assert.equal(placeholders[0].metadata.repositoryJobId, first);
  assert.equal(placeholders[0].metadata.repositoryJobStatus, "queued");

  const another = await createRepositoryChatJob({ ...input, prompt: "Which methods recur?" }, PLAN, 3);
  assert.notEqual(another, first, "another question is another job");
  const detached = [
    await createRepositoryChatJob({ ...input, sourceMessageId: null }, PLAN, 3),
    await createRepositoryChatJob({ ...input, sourceMessageId: null }, PLAN, 3),
  ];
  assert.notEqual(detached[0], detached[1], "with no message to tie it to, each request is its own job");
  const count = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM repository_chat_jobs`);
  assert.equal(count.rows[0].count, 4);
  assert.equal((await assistantMessages()).length, 2, "a placeholder only for a question in the conversation");
});

test("the finished answer replaces the placeholder in place, and finishing twice changes nothing", async () => {
  const { db, thread, createRepositoryChatJob, claimRepositoryChatJob, completeRepositoryChatJob, failRepositoryChatJob, input, assistantMessages, job } = await workspace();
  const id = await createRepositoryChatJob(input, PLAN, 3);
  const [placeholder] = await assistantMessages();
  assert.ok(await claimRepositoryChatJob(OWNER, id));
  const answer = "The repository centres on feedback and vocabulary learning.";
  await completeRepositoryChatJob(OWNER, id, result(answer));

  const replaced = await assistantMessages();
  assert.equal(replaced.length, 1, "the answer took the placeholder's place rather than being added beside it");
  assert.equal(replaced[0].id, placeholder.id);
  assert.equal(replaced[0].message_kind, "chat");
  assert.equal(replaced[0].content, answer);
  assert.equal(replaced[0].metadata.mode, "grounded");
  assert.equal(replaced[0].metadata.repositoryJobStatus, "succeeded");
  assert.deepEqual(await job(id), { status: "succeeded", result_text: answer, error_message: null, progress_current: 3, progress_total: 3, done: true });
  const summary = await db.query<{ summary: string }>(`SELECT summary FROM workspace_threads WHERE id = $1`, [thread.id]);
  assert.equal(summary.rows[0].summary, answer);

  // A late duplicate delivery, a failure after the fact, or the request made again.
  await completeRepositoryChatJob(OWNER, id, result("A second answer."));
  await failRepositoryChatJob(OWNER, id, new Error("late failure"));
  assert.equal(await createRepositoryChatJob(input, PLAN, 3), id);
  const after = await assistantMessages();
  assert.deepEqual(after.map((message) => [message.id, message.content]), [[placeholder.id, answer]]);
  assert.equal((await job(id)).status, "succeeded");
});

test("a failed job tells the reader plainly and keeps the raw error for the logs", async () => {
  const { createRepositoryChatJob, failRepositoryChatJob, CHAT_JOB_FAILED_MESSAGE, input, assistantMessages, job } = await workspace();
  const id = await createRepositoryChatJob(input, PLAN, 3);
  const errors = mock.method(console, "error", () => undefined);
  try {
    await failRepositoryChatJob(OWNER, id, new Error("connect ECONNREFUSED 10.0.0.7:5432"));
    assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [
      ["repository_chat_job_failed", { jobId: id, message: "connect ECONNREFUSED 10.0.0.7:5432" }],
    ]);
  } finally {
    errors.mock.restore();
  }
  assert.equal((await job(id)).error_message, CHAT_JOB_FAILED_MESSAGE);
  const [message] = await assistantMessages();
  assert.equal(message.message_kind, "status");
  assert.doesNotMatch(message.content, /ECONNREFUSED/);
  assert.deepEqual(message.metadata.repositoryLimitations, [CHAT_JOB_FAILED_MESSAGE]);
});

test("a job is claimed once; its heartbeat keeps the claim, and a claim silent for five minutes is taken over", async () => {
  const { db, createRepositoryChatJob, claimRepositoryChatJob, heartbeatRepositoryChatJob, getRepositoryChatJob, input } = await workspace();
  const id = await createRepositoryChatJob(input, PLAN, 3);
  const quiet = await createRepositoryChatJob({ ...input, prompt: "Which methods recur?" }, PLAN, 3);
  const age = (job: string, interval: string) => db.query(`UPDATE repository_chat_jobs SET updated_at = now() - $2::interval WHERE id = $1`, [job, interval]);
  const updatedAt = async (job: string) => (await db.query<{ at: Date }>(`SELECT updated_at AS at FROM repository_chat_jobs WHERE id = $1`, [job])).rows[0].at.getTime();

  assert.equal(await claimRepositoryChatJob(OTHER, id), null, "another person cannot claim it");
  assert.equal(await getRepositoryChatJob(OTHER, id), null, "nor read it");
  assert.equal((await claimRepositoryChatJob(OWNER, id))?.status, "processing");
  assert.equal(await claimRepositoryChatJob(OWNER, id), null, "a running job is not claimed twice");

  await age(id, "4 minutes 50 seconds");
  assert.equal(await claimRepositoryChatJob(OWNER, id), null, "not yet silent for five minutes");
  await age(id, "4 minutes");
  const before = await updatedAt(id);
  await heartbeatRepositoryChatJob(OWNER, id);
  assert.ok((await updatedAt(id)) - before > 3 * 60_000, "the heartbeat renews the claim");

  await age(id, "6 minutes");
  assert.equal((await claimRepositoryChatJob(OWNER, id))?.status, "processing", "a silent claim is taken over");

  await age(quiet, "1 hour");
  const queuedAt = await updatedAt(quiet);
  await heartbeatRepositoryChatJob(OWNER, quiet);
  assert.equal(await updatedAt(quiet), queuedAt, "a heartbeat does not touch a job nobody is running");
});

test("finished jobs older than thirty days are cleared when the next one is made, and only the maker's", async () => {
  const { db, createRepositoryChatJob, input } = await workspace();
  await db.exec(`
    INSERT INTO repository_chat_jobs (id, owner_user_id, project_id, prompt, status, completed_at, created_at) VALUES
      ('00000000-0000-4000-8000-000000000001', '${OWNER}', '${PROJECT}', 'old', 'succeeded', now() - interval '31 days', now() - interval '31 days'),
      ('00000000-0000-4000-8000-000000000002', '${OWNER}', '${PROJECT}', 'recent', 'failed', now() - interval '29 days', now() - interval '29 days'),
      ('00000000-0000-4000-8000-000000000003', '${OWNER}', '${PROJECT}', 'never finished', 'queued', NULL, now() - interval '40 days'),
      ('00000000-0000-4000-8000-000000000009', '${OTHER}', '${OTHER_PROJECT}', 'theirs', 'succeeded', now() - interval '31 days', now() - interval '31 days');
  `);
  const made = await createRepositoryChatJob(input, PLAN, 3);
  const left = await db.query<{ id: string }>(`SELECT id FROM repository_chat_jobs ORDER BY id`);
  assert.deepEqual(left.rows.map((row) => row.id), [
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000009",
    made,
  ].sort());
});

test("a job is queued as one task named for it, with thirty minutes to run, called back at the service's own address", async () => {
  const { enqueueRepositoryChatJob } = await import("../src/lib/repository-chat-jobs");
  const { getPublicRequestOrigin } = await import("../src/lib/public-request-origin");
  const env = {
    GOOGLE_CLOUD_PROJECT_ID: "papertrend-tests",
    GOOGLE_CLOUD_REGION: "asia-southeast1",
    REPOSITORY_CHAT_TASKS_QUEUE: "chat-jobs",
    TASKS_OIDC_SERVICE_ACCOUNT: "web@papertrend-tests.iam.gserviceaccount.com",
    APP_PUBLIC_URL: "https://papertrend.test",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let status = 200;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).startsWith("http://metadata.google.internal/")) {
      return new Response(JSON.stringify({ access_token: "metadata-token" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status });
  }) as typeof fetch;
  try {
    // The callback address is configured, never taken from the request.
    const base = getPublicRequestOrigin(new Request("https://attacker.example/api/chat", { headers: { "x-forwarded-host": "attacker.example" } }));
    assert.equal(base, "https://papertrend.test");

    const id = "5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
    assert.equal(await enqueueRepositoryChatJob(id, OWNER, base), true);
    const task = calls.find((call) => call.url.startsWith("https://cloudtasks.googleapis.com/"));
    assert.ok(task);
    assert.equal(task.url, "https://cloudtasks.googleapis.com/v2/projects/papertrend-tests/locations/asia-southeast1/queues/chat-jobs/tasks");
    assert.equal(new Headers(task.init.headers).get("authorization"), "Bearer metadata-token");
    const body = JSON.parse(String(task.init.body)).task;
    assert.equal(body.name, `projects/papertrend-tests/locations/asia-southeast1/queues/chat-jobs/tasks/repository-chat-${id}`);
    assert.equal(body.dispatchDeadline, "1800s");
    assert.equal(body.httpRequest.url, "https://papertrend.test/api/chat/jobs/process");
    assert.deepEqual(body.httpRequest.oidcToken, { serviceAccountEmail: env.TASKS_OIDC_SERVICE_ACCOUNT, audience: "https://papertrend.test" });
    assert.deepEqual(JSON.parse(Buffer.from(body.httpRequest.body, "base64").toString("utf8")), { jobId: id, ownerUserId: OWNER });

    status = 409;
    assert.equal(await enqueueRepositoryChatJob(id, OWNER, base), true, "a task already queued under that name is not a failure");
    status = 500;
    assert.equal(await enqueueRepositoryChatJob(id, OWNER, base), false);

    calls.length = 0;
    delete process.env.REPOSITORY_CHAT_TASKS_QUEUE;
    delete process.env.CLOUD_TASKS_QUEUE;
    assert.equal(await enqueueRepositoryChatJob(id, OWNER, base), false, "no queue, nothing sent");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a job's progress is its owner's to read", async () => {
  const { request, owner, other, createRepositoryChatJob, input } = await workspace();
  const id = await createRepositoryChatJob(input, PLAN, 3);
  const { GET } = await import("../src/app/api/chat/jobs/[jobId]/route");
  const poll = (headers: Record<string, string>) => GET(request(`/api/chat/jobs/${id}`, { headers }), params({ jobId: id }));
  const mine = await poll(owner);
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).job.status, "queued");
  assert.equal((await poll(other)).status, 404);
  assert.equal((await poll({})).status, 401);
});

test("repository tasks get thirty minutes from the web service's own deadline", () => {
  // Deploy configuration, read as data.
  assert.match(read("../cloudbuild.web.production.yaml"), /--timeout[\s\S]{0,30}"1800"/);
  assert.match(read("../cloudbuild.web.cloudsql.pilot.yaml"), /--timeout[\s\S]{0,30}"1800"/);
});

test("client polling resumes persisted jobs without appending duplicate answers", () => {
  // ChatClient needs the auth and workspace providers and a browser's timers to
  // poll, so its polling is read here, not run; the server half is run above.
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /message\.metadata\?\.repositoryJobId/);
  assert.match(client, /repositoryJobPollsRef/);
  assert.match(client, /await loadThreadDetail\(threadId\)/);
  assert.doesNotMatch(client, /setMessages\(\(current\) => \[\.\.\.current, localMessage\(/);
});
