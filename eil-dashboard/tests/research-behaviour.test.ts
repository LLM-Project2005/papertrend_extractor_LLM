/*
 * Max effort's research engine run rather than read (docs/32, long-term health): planned,
 * started, retried, re-queued and called back through its routes, against
 * PGlite under the app's role (tests/support/route-harness.ts). The model,
 * Cloud Tasks and Google's token keys are fakes behind fetch; nothing leaves
 * the process.
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { params, routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const RUN = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
const ORIGIN = "https://papertrend.test";
const SERVICE = "papertrend-web@research-trend-analysis.iam.gserviceaccount.com";
const WORKER = "papertrend-worker@research-trend-analysis.iam.gserviceaccount.com";
const KID = "research-test-key";
const QUESTION = "How was dynamic assessment used with Thai EFL learners?";
const FILLER = "The study was conducted over one semester with regular classroom sessions and teacher observation notes. ";
const BODY = `${FILLER}Dynamic assessment was used with Thai EFL learners: the teacher offered graduated prompts during writing tasks, and learners' scores rose from 12 to 18 across the semester. ${FILLER}`;
const TOKENS_PER_CALL = 120;

const ENV: Record<string, string | undefined> = {
  OPENAI_API_KEY: "test-key",
  OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
  APP_PUBLIC_URL: `${ORIGIN}/workspace`,
  TASKS_OIDC_SERVICE_ACCOUNT: SERVICE,
  WORKER_CALLER_SERVICE_ACCOUNTS: WORKER,
  GOOGLE_CLOUD_PROJECT_ID: "papertrend-tests",
  // No queue: a start runs the research in its own request.
  DEEP_RESEARCH_TASKS_QUEUE: undefined,
  REPOSITORY_CHAT_TASKS_QUEUE: undefined,
  CLOUD_TASKS_QUEUE: undefined,
};

/* ------------------------------------------------------------ the fakes */

interface ModelCall {
  tool: string;
  model: string;
  system: string;
  user: string;
}

const world = {
  calls: [] as ModelCall[],
  tasks: [] as Array<{ url: string; oidc: unknown; body: unknown }>,
  failReport: false,
};

const PLAN = {
  title: "Dynamic assessment with Thai EFL learners",
  language: "English",
  papers: [{ id: "S1", reason: "Dynamic assessment with Thai EFL learners" }],
  aspects: ["how dynamic assessment was used", "results with their numbers"],
  outline: ["What the papers found", "How it was done"],
  searchTerms: ["dynamic assessment Thai EFL", "graduated prompts writing"],
  web: [],
};
const QUOTE = "the teacher offered graduated prompts during writing tasks, and learners' scores rose from 12 to 18 across the semester.";
// E1 is the paper itself; E2 the fact read from it.
const REPORT = [
  "## Answer",
  "",
  "In one Thai classroom, graduated prompts raised learners' writing scores [E2].",
  "",
  "## What the papers found",
  "",
  "Scores rose from 12 to 18 across the semester [E2].",
  "",
  "## Limits",
  "",
  "The papers searched do not address primary schools.",
].join("\n");
const SENTENCE = /^(S\d+): /gm;

function completion(content: string | null, tool?: { name: string; args: unknown }) {
  return Response.json({
    model: "fake",
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: TOKENS_PER_CALL, cost: 0.001 },
    choices: [{ message: { content, tool_calls: tool ? [{ type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] : [] } }],
  });
}

function fakeModel(body: { model: string; messages: Array<{ role: string; content: string }>; tool_choice?: { function?: { name?: string } } }) {
  const tool = body.tool_choice?.function?.name ?? "report";
  const user = body.messages[body.messages.length - 1]?.content ?? "";
  world.calls.push({ tool, model: body.model, system: body.messages[0]?.content ?? "", user });
  const ids = [...user.matchAll(SENTENCE)].map((match) => match[1]);
  if (tool === "plan_reading") return completion(null, { name: tool, args: PLAN });
  if (tool === "record_paper") {
    const found = user.includes("12 to 18");
    const facts = found ? [{ aspect: "results with their numbers", kind: "finding", statement: "Learners' writing scores rose from 12 to 18 across the semester.", quote: QUOTE, section: "Text", own: true }] : [];
    return completion(null, { name: tool, args: { relevant: found, facts, notReported: [] } });
  }
  if (tool === "revise_sentences") return completion(null, { name: tool, args: { revisions: ids.map((id) => ({ id, text: "" })) } });
  return completion(world.failReport ? "" : REPORT);
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://openrouter.ai/api/v1/chat/completions") return fakeModel(JSON.parse(String(init?.body)));
  if (url.startsWith("http://metadata.google.internal/") && url.endsWith("/token")) return Response.json({ access_token: "fake-access-token" });
  if (url.startsWith("https://cloudtasks.googleapis.com/v2/projects/papertrend-tests/locations/asia-southeast1/queues/deep-research/tasks")) {
    const { task } = JSON.parse(String(init?.body));
    world.tasks.push({ url: task.httpRequest.url, oidc: task.httpRequest.oidcToken, body: JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString()) });
    return Response.json({ name: task.name });
  }
  throw new Error(`A test made an unexpected request: ${url}`);
}) as typeof fetch;

// Google's published keys, replaced by a test key's public half.
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
OAuth2Client.prototype.getFederatedSignonCertsAsync = async function () {
  return { certs: { [KID]: signing.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" } as never;
};

function taskToken(claims: Record<string, unknown> = {}, key: KeyObject = signing.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = { iss: "https://accounts.google.com", aud: ORIGIN, sub: "1234567890", email: SERVICE, email_verified: true, iat: now - 10, exp: now + 600, ...claims };
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode(payload)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key).toString("base64url")}`;
}

/* ------------------------------------------------------------ the workspace */

async function workspace(env: Record<string, string | undefined> = {}) {
  world.calls = [];
  world.tasks = [];
  world.failReport = false;
  const harness = await routeHarness({ ...ENV, ...env });
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  const paperId = paperIdFromRunId(RUN);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('${ORG}', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '${ORG}', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Papers', '${PROJECT}');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload, completed_at)
      VALUES ('${RUN}', '${OWNER}', '${FOLDER}', 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb, now());
    INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES (${paperId}, '${OWNER}', '${FOLDER}', '2021', 'Dynamic Assessment in a Thai EFL Classroom');
  `);
  await harness.db.query(
    `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract, body) VALUES ($1, $2, $3, $4, $5, $6)`,
    [paperId, OWNER, FOLDER, RUN, "This study examined dynamic assessment with Thai EFL learners.", BODY]
  );
  // Every status a session takes, as the database sees it.
  await harness.db.exec(`
    CREATE TABLE session_status_log (id serial PRIMARY KEY, session_id uuid NOT NULL, status text NOT NULL);
    CREATE FUNCTION log_session_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO session_status_log (session_id, status) VALUES (NEW.id, NEW.status);
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER log_session_status AFTER INSERT OR UPDATE ON deep_research_sessions FOR EACH ROW EXECUTE FUNCTION log_session_status();
  `);
  return { ...harness, owner, other };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

async function research(h: Workspace, headers: Record<string, string>, body: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/chat/route");
  const response = await POST(h.request("/api/chat", { headers, body: { chatMode: "deep_research", ...body } }));
  return { status: response.status, body: await response.json() };
}

const ask = (h: Workspace, headers: Record<string, string>, message: string, threadId?: string) =>
  research(h, headers, { action: "plan", message, projectId: PROJECT, knowledgeScope: { kind: "project", projectId: PROJECT }, ...(threadId ? { threadId } : {}) });

const start = (h: Workspace, headers: Record<string, string>, threadId: string, sessionId: string) =>
  research(h, headers, { action: "continue", threadId, sessionId });

async function statusLog(h: Workspace, sessionId: string) {
  return (await h.db.query<{ status: string }>(`SELECT status FROM session_status_log WHERE session_id = $1 ORDER BY id`, [sessionId])).rows.map((row) => row.status);
}

async function sessionStatus(h: Workspace, sessionId: string) {
  return (await h.db.query<{ status: string }>(`SELECT status FROM deep_research_sessions WHERE id = $1`, [sessionId])).rows[0]?.status;
}

async function researchUnits(h: Workspace, ownerUserId = OWNER) {
  return (await h.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ai_usage_events WHERE owner_user_id = $1 AND usage_kind = 'deep_research'`, [ownerUserId])).rows[0].count;
}

const calls = (tool: string) => world.calls.filter((call) => call.tool === tool);

/* ------------------------------------------------------------ the run */

test("a run goes from planned to processing to completed, never through the statuses the old worker claims, and its report joins the conversation", async () => {
  const h = await workspace();
  const planned = await ask(h, h.owner, QUESTION);
  assert.equal(planned.status, 200);
  const session = planned.body.deepResearchSession;
  assert.equal(session.status, "planned");
  assert.deepEqual(session.steps.map((step: { tool_name: string }) => step.tool_name), ["dr2_read", "dr2_write", "dr2_check"]);
  assert.equal(session.steps[0].title, "Read Dynamic Assessment in a Thai EFL Classroom (2021)");

  const done = await start(h, h.owner, planned.body.thread.id, session.id);
  assert.equal(done.status, 200);
  assert.equal(done.body.deepResearchSession.status, "completed");
  assert.deepEqual(await statusLog(h, session.id), ["planned", "processing", "completed"]);

  const report = done.body.messages.find((message: { message_kind: string }) => message.message_kind === "deep_research_report");
  assert.ok(report, "the report is a message in the thread");
  assert.match(report.content, /Scores rose from 12 to 18/);
  assert.doesNotMatch(report.content, /\[E\d/, "no evidence id is left for the reader");
  assert.deepEqual(report.citations.map((citation: { href: string }) => citation.href), [`/workspace/library?paperId=${paperIdFromRunId(RUN)}`]);
});

test("each chosen paper is read whole, and the answer is written from the facts whose quotes are in it", async () => {
  const h = await workspace();
  const planned = await ask(h, h.owner, QUESTION);
  const [planner] = calls("plan_reading");
  assert.match(planner.user, /^\[S1\] Dynamic Assessment in a Thai EFL Classroom \(2021\)/m, "the planner sees a card per study, not a database id");
  assert.ok(!planner.user.includes(String(paperIdFromRunId(RUN))));
  await start(h, h.owner, planned.body.thread.id, planned.body.deepResearchSession.id);
  const [reader] = calls("record_paper");
  assert.match(reader.user, /Read: the whole paper/);
  assert.ok(reader.user.includes(QUOTE), "the paper's own text, not a passage chosen from it");
  const [writer] = calls("report");
  assert.ok(writer.user.includes(QUOTE), "the writer sees the quote the fact rests on");
  assert.equal(calls("revise_sentences").length, 0, "an answer that checks out needs no second call");
  assert.deepEqual([...new Set(world.calls.map((call) => call.model))], ["openai/gpt-6-luna-20260922"]);
});

test("a paper High would read is read too, even when the planner passed it over", async () => {
  const h = await workspace();
  const run2 = "7c8d9e0f-a1b2-4c3d-8e4f-5a6b7c8d9e01";
  const second = paperIdFromRunId(run2);
  await h.db.exec(`
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload, completed_at)
      VALUES ('${run2}', '${OWNER}', '${FOLDER}', 'upload', 'succeeded', 'second.pdf', '{}'::jsonb, now());
    INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES (${second}, '${OWNER}', '${FOLDER}', '2023', 'Graduated Prompts in Thai EFL Writing');
  `);
  await h.db.query(
    `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract, body) VALUES ($1, $2, $3, $4, $5, $6)`,
    [second, OWNER, FOLDER, run2, "Graduated prompts in dynamic assessment helped Thai EFL writers revise.", BODY]
  );
  // The planner chooses only S1; High's selection (its reranker unreadable here, so its ranking) has both.
  const planned = await ask(h, h.owner, QUESTION);
  const reads = planned.body.deepResearchSession.steps
    .filter((step: { tool_name: string }) => step.tool_name === "dr2_read")
    .map((step: { input_payload: { paper: { title: string; via: string } } }) => [step.input_payload.paper.title, step.input_payload.paper.via]);
  assert.deepEqual(reads, [
    ["Dynamic Assessment in a Thai EFL Classroom", "planner"],
    ["Graduated Prompts in Thai EFL Writing", "high"],
  ], "the planner's paper first, then High's other paper");
  assert.equal(world.calls.filter((call) => call.system.includes("Select at most")).length, 1, "High's reranker was asked, with the run's model");
  assert.equal(world.calls.find((call) => call.system.includes("Select at most"))?.model, "openai/gpt-6-luna-20260922");
});

test("a lease holds a run to one worker; a released or expired lease can be taken again", async () => {
  const h = await workspace();
  const planned = await ask(h, h.owner, QUESTION);
  const id = planned.body.deepResearchSession.id;
  const store = await import("../src/lib/deep-research/store");
  assert.equal(await store.claimSession(OWNER, id), null, "a plan not yet started cannot be claimed");
  assert.deepEqual(await store.startSession(OWNER, id), { started: true, firstStart: true });
  assert.deepEqual(await store.startSession(OWNER, id), { started: false, firstStart: false }, "a running session is not started twice");
  assert.equal(await store.claimSession(OTHER, id), null, "nor claimed by someone else");
  assert.ok(await store.claimSession(OWNER, id), "the first worker takes it at once");
  assert.equal(await store.claimSession(OWNER, id), null, "a second worker does not");
  assert.equal(await store.heartbeat(OWNER, id), true);
  await store.releaseLease(OWNER, id);
  assert.ok(await store.claimSession(OWNER, id), "a released lease is free at once");

  const leaseAge = (seconds: number) => h.db.query(`UPDATE deep_research_sessions SET updated_at = now() - make_interval(secs => $2) WHERE id = $1`, [id, seconds]);
  await leaseAge(store.LEASE_SECONDS - 5);
  assert.equal(await store.claimSession(OWNER, id), null, "a lease still running is kept");
  await leaseAge(store.LEASE_SECONDS + 5);
  assert.ok(await store.claimSession(OWNER, id), "an expired lease is free");

  assert.equal(await store.cancelSession(OWNER, id), true);
  assert.equal(await store.heartbeat(OWNER, id), false, "a canceled run's worker learns it has stopped");
  assert.equal(await store.claimSession(OWNER, id), null);
  assert.ok(!(await statusLog(h, id)).some((status) => status === "queued" || status === "waiting_on_analysis"));
});

test("asking again replaces a plan not yet started; after a report, a new question adds a session and the report stays", async () => {
  const h = await workspace();
  const first = await ask(h, h.owner, QUESTION);
  const thread = first.body.thread.id;
  const firstId = first.body.deepResearchSession.id;
  const sessionsIn = async () =>
    (await h.db.query<{ id: string; status: string; final_report: string | null }>(`SELECT id, status, final_report FROM deep_research_sessions WHERE thread_id = $1 ORDER BY created_at`, [thread])).rows;

  const replanned = await ask(h, h.owner, "How did graduated prompts help Thai EFL writers?", thread);
  assert.equal(replanned.body.deepResearchSession.id, firstId, "the unstarted plan is planned again in place");
  assert.equal(replanned.body.deepResearchSession.prompt, "How did graduated prompts help Thai EFL writers?");
  assert.equal((await sessionsIn()).length, 1);
  const steps = await h.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM deep_research_steps WHERE session_id = $1`, [firstId]);
  assert.equal(steps.rows[0].count, 3, "its old steps were replaced, not added to");

  await start(h, h.owner, thread, firstId);
  const next = await ask(h, h.owner, "What did the teacher observe?", thread);
  assert.notEqual(next.body.deepResearchSession.id, firstId, "a finished run is not planned over");
  const sessions = await sessionsIn();
  assert.deepEqual(sessions.map((session) => session.status), ["completed", "planned"]);
  assert.match(sessions[0].final_report ?? "", /Scores rose from 12 to 18/);
  assert.equal(next.body.messages.filter((message: { message_kind: string }) => message.message_kind === "deep_research_report").length, 1, "the earlier report is still in the conversation");
});

test("a run costs one deep research unit on its first start; a retry after a failure is free and resumes where it stopped", async () => {
  const h = await workspace();
  const planned = await ask(h, h.owner, QUESTION);
  const thread = planned.body.thread.id;
  const id = planned.body.deepResearchSession.id;
  assert.equal(await researchUnits(h), 0, "planning is not a run");

  world.failReport = true;
  const failed = await start(h, h.owner, thread, id);
  assert.equal(failed.body.deepResearchSession.status, "failed");
  assert.equal(await researchUnits(h), 1);
  assert.equal(calls("record_paper").length, 1);

  world.failReport = false;
  const retried = await start(h, h.owner, thread, id);
  assert.equal(retried.body.deepResearchSession.status, "completed");
  assert.equal(await researchUnits(h), 1, "the retry is free");
  assert.equal(calls("record_paper").length, 1, "a paper already read is not read again");
  assert.equal(calls("report").length, 2, "the step that failed is");

  // A plan canceled before it ever ran is still charged when it starts.
  const later = await ask(h, h.owner, "What did the teacher observe?");
  const canceled = await research(h, h.owner, { action: "cancel", threadId: later.body.thread.id, sessionId: later.body.deepResearchSession.id });
  assert.equal(canceled.body.deepResearchSession.status, "canceled");
  const resumed = await start(h, h.owner, later.body.thread.id, later.body.deepResearchSession.id);
  assert.equal(resumed.body.deepResearchSession.status, "completed");
  assert.equal(await researchUnits(h), 2);
});

test("a session planned by an earlier engine, or someone else's, is refused, not run and not charged", async () => {
  const h = await workspace();
  const thread = "00000000-0000-4000-8000-0000000000d1";
  const old = "00000000-0000-4000-8000-0000000000d2";
  await h.db.exec(`
    INSERT INTO workspace_threads (id, owner_user_id, mode, title) VALUES ('${thread}', '${OWNER}', 'deep_research', 'Earlier research');
    INSERT INTO deep_research_sessions (id, thread_id, owner_user_id, status, prompt) VALUES ('${old}', '${thread}', '${OWNER}', 'planned', 'An earlier question');
    INSERT INTO deep_research_steps (session_id, owner_user_id, position, title, tool_name) VALUES ('${old}', '${OWNER}', 1, 'Fetch papers', 'fetch_papers');
  `);
  const refused = await start(h, h.owner, thread, old);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /planned by an earlier version of Papertrend/);
  assert.equal(await sessionStatus(h, old), "planned");

  // Deep research v2 searched passages per sub-question; its plans are planned again too.
  const v2 = "00000000-0000-4000-8000-0000000000d3";
  await h.db.exec(`
    INSERT INTO deep_research_sessions (id, thread_id, owner_user_id, status, prompt) VALUES ('${v2}', '${thread}', '${OWNER}', 'planned', 'A v2 question');
    INSERT INTO deep_research_steps (session_id, owner_user_id, position, title, tool_name, input_payload) VALUES
      ('${v2}', '${OWNER}', 1, 'A sub-question', 'dr2_gather', '{}'::jsonb),
      ('${v2}', '${OWNER}', 2, 'Write the answer', 'dr2_write', '{"engine":"deep-research-v2"}'::jsonb);
  `);
  const refusedV2 = await start(h, h.owner, thread, v2);
  assert.equal(refusedV2.status, 409);
  assert.equal(await sessionStatus(h, v2), "planned");

  const mine = await ask(h, h.owner, QUESTION);
  const theirs = await start(h, h.other, mine.body.thread.id, mine.body.deepResearchSession.id);
  assert.equal(theirs.status, 409);
  assert.equal(await sessionStatus(h, mine.body.deepResearchSession.id), "planned");
  assert.equal(await researchUnits(h, OWNER), 0);
  assert.equal(await researchUnits(h, OTHER), 0);
  assert.equal(calls("record_paper").length, 0, "nothing ran");
});

/* ------------------------------------------------------------ the queue */

test("only this service's own tasks can run a queued session, and what the run spent is recorded", async () => {
  const h = await workspace({ DEEP_RESEARCH_TASKS_QUEUE: "deep-research" });
  const planned = await ask(h, h.owner, QUESTION);
  const id = planned.body.deepResearchSession.id;
  const started = await start(h, h.owner, planned.body.thread.id, id);
  assert.equal(started.body.deepResearchSession.status, "processing", "queued, not run in the request");
  assert.equal(world.tasks.length, 1);
  const [task] = world.tasks;
  assert.equal(task.url, `${ORIGIN}/api/chat/research/process`);
  assert.deepEqual(task.body, { sessionId: id, ownerUserId: OWNER });
  assert.deepEqual(task.oidc, { serviceAccountEmail: SERVICE, audience: ORIGIN });

  const { POST } = await import("../src/app/api/chat/research/process/route");
  const deliver = (headers: Record<string, string>, body: unknown = task.body) =>
    POST(new Request(task.url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const before = world.calls.length;
  const refused: Array<[string, Record<string, string>]> = [
    ["no token", {}],
    ["a signed-in person's token", h.owner],
    ["the analysis worker's account", { authorization: `Bearer ${taskToken({ email: WORKER })}` }],
    ["a token signed with another key", { authorization: `Bearer ${taskToken({}, stranger.privateKey)}` }],
    ["a token for another address", { authorization: `Bearer ${taskToken({ aud: "https://elsewhere.example" })}` }],
  ];
  for (const [name, headers] of refused) assert.equal((await deliver(headers)).status, 401, name);
  assert.equal(world.calls.length, before, "nothing ran");
  assert.equal(await sessionStatus(h, id), "processing");

  const valid = { authorization: `Bearer ${taskToken()}` };
  assert.equal((await deliver(valid, { sessionId: "not-a-uuid", ownerUserId: OWNER })).status, 400);
  const ran = await deliver(valid);
  assert.equal(ran.status, 200);
  assert.deepEqual(await ran.json(), { ok: true, outcome: "completed" });
  assert.equal(await sessionStatus(h, id), "completed");

  const runCalls = world.calls.length - before;
  assert.equal(runCalls, 2, "reading the paper, and the answer");
  const spend = await h.db.query<{ units: number; metadata: Record<string, unknown> }>(
    `SELECT units, metadata FROM ai_usage_events WHERE owner_user_id = $1 AND usage_kind = 'chat_message' AND metadata->>'source' = 'deep-research'`,
    [OWNER]
  );
  assert.equal(spend.rows.length, 1);
  assert.equal(spend.rows[0].units, runCalls * TOKENS_PER_CALL, "counted toward the daily token budget");
  assert.equal(spend.rows[0].metadata.model_calls, runCalls);

  const again = await deliver(valid);
  assert.deepEqual(await again.json(), { ok: true, outcome: "skipped" }, "a second delivery of the task finds nothing to do");
});

test("opening a thread whose run went quiet queues it once more; a live run, or someone else's thread, is left alone", async () => {
  const h = await workspace({ DEEP_RESEARCH_TASKS_QUEUE: "deep-research" });
  const planned = await ask(h, h.owner, QUESTION);
  const thread = planned.body.thread.id;
  const id = planned.body.deepResearchSession.id;
  await start(h, h.owner, thread, id);
  assert.equal(world.tasks.length, 1);

  const { GET } = await import("../src/app/api/chat/threads/[threadId]/route");
  const open = (headers: Record<string, string>) => GET(h.request(`/api/chat/threads/${thread}`, { headers }), params({ threadId: thread }));
  assert.equal((await open(h.owner)).status, 200);
  assert.equal(world.tasks.length, 1, "a run just started is not queued again");

  await h.db.query(`UPDATE deep_research_sessions SET updated_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
  const stranger = await open(h.other);
  assert.notEqual(stranger.status, 200);
  assert.equal((await stranger.json()).deepResearchSession, undefined);
  assert.equal(world.tasks.length, 1, "someone else opening it queues nothing");

  assert.equal((await open(h.owner)).status, 200);
  assert.equal(world.tasks.length, 2, "a run gone quiet is queued again");
  assert.deepEqual(world.tasks[1].body, { sessionId: id, ownerUserId: OWNER });
  await open(h.owner);
  await open(h.owner);
  assert.equal(world.tasks.length, 2, "once, however often the page polls");

  const store = await import("../src/lib/deep-research/store");
  assert.ok(await store.claimSession(OWNER, id), "the new task can take the lease at once");
});
