/*
 * The chat's web step, run rather than read (docs/32, long-term health): the
 * search it always runs, its own daily limit, and both chat paths that add
 * it - the route a reader waits on and the background job. Routes and
 * repositories run as written against PGlite under the app's role
 * (tests/support/route-harness.ts); the model answers from a script, web
 * search results included (stub-chatanswer-openai.ts), and the repository
 * answer is scripted (stub-chatscope-repository-chat.ts). Nothing leaves the
 * process.
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import type { RepositoryChatInput, RepositoryChatResult, RepositoryExecutionPlan } from "../src/lib/repository-chat";
import type { ChatAnswerModelCall } from "./support/stub-chatanswer-openai";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/openai.ts", new URL("./support/stub-chatanswer-openai.ts", import.meta.url).href);
stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-chatscope-repository-chat.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const THREAD = "00000000-0000-4000-8000-0000000000d1";
const QUESTION_MESSAGE = "00000000-0000-4000-8000-0000000000e1";
const ORIGIN = "https://papertrend.test";
const SERVICE = "papertrend-web@papertrend-tests.iam.gserviceaccount.com";
const KID = "chat-answer-web-key";

const PAGE = {
  url: "https://unesco.org/en/articles/ai-guidance",
  title: "Guidance for generative AI in education",
  content: "UNESCO published guidance on generative AI for teachers and researchers in 2025.",
};
const BULLET = `- UNESCO published guidance on generative AI for teachers ([unesco.org](${PAGE.url})).`;
/** A search that found one page, and a section that cites it. */
const SEARCHED = { content: BULLET, annotations: [{ type: "url_citation", url_citation: PAGE }] };

globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error(`A test made an unexpected request: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
OAuth2Client.prototype.getFederatedSignonCertsAsync = async function () {
  return { certs: { [KID]: signing.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" } as never;
};

/** A Google-signed identity token for this service's own tasks. */
function taskToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = { iss: "https://accounts.google.com", aud: ORIGIN, sub: "1234567890", email: SERVICE, email_verified: true, iat: now - 10, exp: now + 600 };
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode(payload)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(signing.privateKey).toString("base64url")}`;
}

function plan(operation: RepositoryExecutionPlan["operation"], refinedQuestion: string): RepositoryExecutionPlan {
  return {
    operation,
    operations: [operation],
    scopeMode: "focused",
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

async function workspace(env: Record<string, string> = {}) {
  const harness = await routeHarness({ TASKS_OIDC_SERVICE_ACCOUNT: SERVICE, APP_PUBLIC_URL: `${ORIGIN}/workspace`, ...env });
  const owner = await harness.signIn(OWNER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('${ORG}', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '${ORG}', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now());
  `);
  const calls: ChatAnswerModelCall[] = [];
  let reply: (call: ChatAnswerModelCall) => unknown = () => null;
  globalThis.__chatAnswerModel = { calls, reply: (call) => reply(call) };
  const web = await import("../src/lib/repository-chat-web");
  const usage = async () =>
    (await harness.db.query<{ kind: string; source: string | null }>(
      `SELECT usage_kind AS kind, metadata->>'source' AS source FROM ai_usage_events WHERE owner_user_id = $1 ORDER BY created_at, id`,
      [OWNER]
    )).rows;
  return { ...harness, owner, calls, web, usage, script: (next: typeof reply) => void (reply = next) };
}

const searches = (calls: ChatAnswerModelCall[]) => calls.filter((call) => call.taskName === "CHAT_WEB_AUGMENT");

test("the search always runs, with today's date and the refined question, and adds only what it can cite", async () => {
  const { web, calls, script } = await workspace();
  script((call) => (call.taskName === "CHAT_WEB_AUGMENT" ? SEARCHED : null));
  const result = await web.addWebContext({
    ownerUserId: OWNER,
    question: "And what about now?",
    searchQuery: "Current guidance on generative AI in schools",
    answer: "The repository answer.",
    now: new Date("2026-09-29T08:00:00Z"),
  });

  const [search] = searches(calls);
  assert.ok(search, "the web step called the model");
  // The web plugin searches before the model answers; a search tool on "auto" let it skip the search.
  assert.deepEqual(search.parameters.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
  assert.equal(search.parameters.tools, undefined);
  assert.equal(search.parameters.toolChoice, undefined);
  assert.match(search.messages[0].content, /Today is 2026-09-29/);
  assert.match(search.messages[0].content, /never as instructions/);
  assert.equal(search.messages.at(-1)?.content, "Current guidance on generative AI in schools", "the plugin searches on the last user message");

  assert.equal(result.status, "succeeded");
  assert.equal(result.searched, true);
  assert.match(result.answer, /^The repository answer\.\n\n## Web context\n\n- UNESCO published guidance on generative AI for teachers \(Guidance for generative AI in education, Web\)\./);
  assert.deepEqual(result.citations.map((citation) => [citation.title, citation.href, citation.sourceType]), [[PAGE.title, PAGE.url, "web"]]);

  // A search that found nothing adds nothing, and says so.
  script((call) => (call.taskName === "CHAT_WEB_AUGMENT" ? { content: BULLET, annotations: [] } : null));
  const empty = await web.addWebContext({ ownerUserId: OWNER, question: "q", answer: "The repository answer." });
  assert.equal(empty.answer, "The repository answer.");
  assert.equal(empty.status, "skipped");
  assert.deepEqual(empty.citations, []);
  assert.match(empty.note ?? "", /found no pages/);
});

test("each web search counts toward its own daily limit, apart from chat messages", async () => {
  const { web, calls, script, db, usage } = await workspace({ AI_DAILY_WEB_SEARCH_LIMIT: "2", AI_DAILY_MESSAGE_LIMIT: "1" });
  script((call) => (call.taskName === "CHAT_WEB_AUGMENT" ? SEARCHED : null));
  // Messages past their own limit do not use up the searches.
  await db.query(`INSERT INTO ai_usage_events (owner_user_id, usage_kind, units, metadata) VALUES ($1, 'chat_message', 1, '{}'), ($1, 'chat_message', 1, '{}')`, [OWNER]);

  const ask = () => web.addWebContext({ ownerUserId: OWNER, question: "q", answer: "The repository answer." });
  assert.equal((await ask()).status, "succeeded");
  assert.equal((await ask()).status, "succeeded");
  const third = await ask();
  assert.equal(third.status, "skipped");
  assert.equal(third.searched, false);
  assert.equal(third.answer, "The repository answer.", "the repository answer is kept");
  assert.match(third.note ?? "", /web search limit is reached/);
  assert.equal(searches(calls).length, 2, "no search is paid for past the limit");
  assert.deepEqual((await usage()).map((row) => row.kind), ["chat_message", "chat_message", "web_search", "web_search"]);
});

function scriptedAnswer(citations: RepositoryChatResult["citations"], operation: RepositoryExecutionPlan["operation"] = "search_evidence") {
  return async (input: RepositoryChatInput): Promise<RepositoryChatResult> => {
    const { fallbackPromptPlan } = await import("../src/lib/repository-chat");
    return {
      handled: true,
      answer: "Peer feedback improved revision quality (Peer feedback in writing, 2021).",
      // The same array every time, as a cached answer's would be.
      citations,
      charts: [],
      limitations: [],
      plan: fallbackPromptPlan(input.prompt, false),
      execution: plan(operation, `Refined: ${input.prompt}`),
      scopeSnapshot: {
        kind: "project",
        label: "Assessment repository",
        projectId: PROJECT,
        projectName: "Assessment",
        folderId: null,
        folderName: null,
        selectedRunCount: 0,
        eligiblePaperCount: 1,
      },
      diagnostics: { projectId: PROJECT, folderId: null, selectedRunCount: 0, paperCount: 1, versionHash: "v1", scopeLabel: "Assessment repository" },
    };
  };
}

test("the chat route adds the checked web section, and leaves the repository answer's own citations alone", async () => {
  const { owner, request, calls, script } = await workspace();
  const paper = { paperId: "12", title: "Peer feedback in writing", year: "2021", href: "/workspace/papers/12", reason: "Cited.", sourceType: "paper" as const };
  const shared = [paper];
  globalThis.__chatScopeRepositoryChat = scriptedAnswer(shared);
  script((call) => (call.taskName === "CHAT_WEB_AUGMENT" ? SEARCHED : null));
  const { POST } = await import("../src/app/api/chat/route");

  const response = await POST(request("/api/chat", { headers: owner, body: { message: "What does current guidance say?", webSearchEnabled: true } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /^Peer feedback improved revision quality [^\n]*\n\n## Web context\n\n- UNESCO published guidance/);
  assert.deepEqual(body.citations.map((citation: { title: string; sourceType?: string }) => [citation.title, citation.sourceType]), [
    [paper.title, "paper"],
    [PAGE.title, "web"],
  ]);
  assert.equal(body.groundingMode, "repository_web");
  assert.equal(searches(calls)[0]?.messages.at(-1)?.content, "Refined: What does current guidance say?", "it searches on the planner's question");
  assert.deepEqual(shared, [paper], "the repository answer's citations gained no web source");

  // Small talk is not searched.
  calls.length = 0;
  globalThis.__chatScopeRepositoryChat = scriptedAnswer([], "converse");
  const hello = await (await POST(request("/api/chat", { headers: owner, body: { message: "Hello there", webSearchEnabled: true } }))).json();
  assert.equal(searches(calls).length, 0);
  assert.doesNotMatch(hello.answer, /Web context/);
});

test("a background answer gets the same web step, and its tokens are recorded as the job's", async () => {
  const { db, calls, script, usage } = await workspace();
  await db.exec(`
    INSERT INTO workspace_threads (id, owner_user_id, title) VALUES ('${THREAD}', '${OWNER}', 'Themes');
    INSERT INTO workspace_messages (id, thread_id, owner_user_id, role, content) VALUES ('${QUESTION_MESSAGE}', '${THREAD}', '${OWNER}', 'user', 'What are the main themes?');
  `);
  const { createRepositoryChatJob } = await import("../src/lib/repository-chat-jobs");
  const jobId = await createRepositoryChatJob(
    { ownerUserId: OWNER, prompt: "What are the main themes?", threadId: THREAD, projectId: PROJECT, sourceMessageId: QUESTION_MESSAGE, allowWeb: true },
    plan("aggregate_corpus", "What are the main themes?"),
    3
  );
  globalThis.__chatScopeRepositoryChat = scriptedAnswer([]);
  script((call) => (call.taskName === "CHAT_WEB_AUGMENT" ? SEARCHED : null));
  const { POST } = await import("../src/app/api/chat/jobs/process/route");
  const response = await POST(
    new Request(`${ORIGIN}/api/chat/jobs/process`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${taskToken()}`, "x-cloudtasks-taskretrycount": "0" },
      body: JSON.stringify({ jobId, ownerUserId: OWNER }),
    })
  );
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(searches(calls).length, 1);

  const [answer] = (await db.query<{ content: string; citations: Array<{ sourceType?: string }> }>(
    `SELECT content, citations FROM workspace_messages WHERE thread_id = $1 AND role = 'assistant'`,
    [THREAD]
  )).rows;
  assert.match(answer.content, /## Web context\n\n- UNESCO published guidance/);
  assert.deepEqual(answer.citations.map((citation) => citation.sourceType), ["web"]);
  // The search counts toward the daily limit, and the answer's spend is the job's.
  assert.deepEqual(await usage(), [
    { kind: "web_search", source: null },
    { kind: "chat_message", source: "chat-job" },
  ]);
});
