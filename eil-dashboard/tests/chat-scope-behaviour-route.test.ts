/*
 * What the chat route does around an answer, run rather than read (docs/32,
 * long-term health): it records the answer's spend on both paths, marks a
 * cached answer, and stops the work when the reader leaves. The route runs as
 * written against PGlite under the app's role (tests/support/route-harness.ts);
 * only the repository chat answers from a script
 * (stub-chatscope-repository-chat.ts).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryChatResult } from "../src/lib/repository-chat";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-chatscope-repository-chat.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";

type Script = (input: RepositoryChatInput) => Promise<Partial<RepositoryChatResult>>;

const DIAGNOSTICS = { projectId: null, folderId: null, selectedRunCount: 0, paperCount: 2, versionHash: "v1", scopeLabel: "All projects" };

async function workspace() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const { fallbackPromptPlan } = await import("../src/lib/repository-chat");
  let script: Script = async () => ({});
  globalThis.__chatScopeRepositoryChat = async (input) => ({
    handled: true,
    answer: `Two papers answer "${input.prompt}".`,
    citations: [],
    charts: [],
    limitations: [],
    plan: fallbackPromptPlan(input.prompt, false),
    scopeSnapshot: {
      kind: "all_projects",
      label: "All projects",
      projectId: null,
      projectName: null,
      folderId: null,
      folderName: null,
      selectedRunCount: 0,
      eligiblePaperCount: 2,
    },
    diagnostics: DIAGNOSTICS,
    ...(await script(input)),
  });
  const { POST } = await import("../src/app/api/chat/route");
  const ask = (headers: Record<string, string>, body: Record<string, unknown>) => POST(harness.request("/api/chat", { headers, body }));
  const stream = { ...owner, accept: "text/event-stream" };
  return { ...harness, owner, stream, ask, POST, answerWith: (next: Script) => void (script = next) };
}

/** The Server-Sent Events frames of a streamed answer, read to the end. */
async function frames(response: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("event: "))
    .map((frame) => {
      const [event, data] = frame.split("\n");
      return { event: event.slice("event: ".length), data: JSON.parse(data.slice("data: ".length)) };
    });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

test("an answer's spend is recorded whether it streams or not, and the same way", async () => {
  // The streamed Response is returned before any model call runs, so a usage
  // scope around it saw nothing: no streamed answer's cost was ever recorded.
  const { db, owner, stream, ask, answerWith } = await workspace();
  const { recordAiTokenUsage } = await import("../src/lib/ai-token-usage");
  answerWith(async () => {
    recordAiTokenUsage({ prompt_tokens: 1_200, completion_tokens: 300, total_tokens: 1_500, cost: 0.0021 }, "google/gemini-3.7-flash");
    return {};
  });

  const plain = await ask(owner, { message: "What is in these papers?" });
  assert.equal(plain.status, 200);
  await plain.json();
  const streamed = await frames(await ask(stream, { message: "What else is in these papers?" }));
  assert.equal(streamed.at(-1)?.event, "result");

  const rows = await db.query<{ units: number; metadata: Record<string, unknown> }>(
    `SELECT units, metadata FROM ai_usage_events WHERE owner_user_id = $1 ORDER BY created_at`,
    [OWNER]
  );
  const recorded = {
    metric: "tokens",
    prompt_tokens: 1_200,
    completion_tokens: 300,
    model_calls: 1,
    cost_usd: 0.0021,
    cost_source: "provider",
    source: "chat",
  };
  assert.deepEqual(rows.rows, [{ units: 1_500, metadata: recorded }, { units: 1_500, metadata: recorded }], "one row per answer, streamed or not");
});

test("failing to record the cost never fails the answer", async () => {
  // The reader asked a question, not for bookkeeping.
  const { db, owner, stream, ask, answerWith } = await workspace();
  const { recordAiTokenUsage } = await import("../src/lib/ai-token-usage");
  answerWith(async () => {
    recordAiTokenUsage({ prompt_tokens: 800, completion_tokens: 200, total_tokens: 1_000 }, "google/gemini-3.7-flash");
    return {};
  });
  await db.exec(`REVOKE INSERT ON ai_usage_events FROM papertrend_app`);
  const errors = mock.method(console, "error", () => undefined);
  try {
    const plain = await ask(owner, { message: "What is in these papers?" });
    assert.equal(plain.status, 200);
    assert.equal((await plain.json()).answer, 'Two papers answer "What is in these papers?".');
    const streamed = await frames(await ask(stream, { message: "What else?" }));
    assert.equal(streamed.at(-1)?.event, "result");
    assert.equal(streamed.at(-1)?.data.answer, 'Two papers answer "What else?".');
    assert.equal(errors.mock.calls.filter((call) => call.arguments[0] === "chat_token_usage_persist_failed").length, 2);
  } finally {
    errors.mock.restore();
  }
  const count = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ai_usage_events`);
  assert.equal(count.rows[0].count, 0);
});

test("a cached answer is marked in the response and in the message the page shows", async () => {
  // An answer that arrives in a second is either cached or wrong, and a reader
  // should not have to guess which.
  const { db, owner, stream, ask, answerWith } = await workspace();
  answerWith(async (input) => (input.prompt.endsWith("again?") ? { diagnostics: { ...DIAGNOSTICS, cached: true } } : {}));

  const fresh = await (await ask(owner, { message: "What are the main topics?" })).json();
  assert.equal(fresh.cached, false);
  const cached = await (await ask(owner, { message: "What are the main topics again?" })).json();
  assert.equal(cached.cached, true);
  const streamed = await frames(await ask(stream, { message: "And the methods again?" }));
  assert.equal(streamed.at(-1)?.data.cached, true);

  const stored = await db.query<{ cached: boolean | null }>(
    `SELECT (metadata->'repositoryDiagnostics'->>'cached')::boolean AS cached FROM workspace_messages WHERE role = 'assistant' ORDER BY created_at`
  );
  assert.deepEqual(stored.rows.map((row) => row.cached), [null, true, true]);
});

test("the work stops when the reader leaves, whether the answer streams or not", async () => {
  // Pressing Stop aborted the browser's fetch while the server kept generating,
  // so the answer went unseen and its tokens were still paid for.
  const { owner, stream, POST, request, answerWith } = await workspace();
  const { cancellationSignal, requestSignal } = await import("../src/lib/chat-cancellation");
  let started = deferred();
  let finished = deferred();
  const seen: Array<{ work: boolean; modelCall: boolean }> = [];
  answerWith(async () => {
    const caller = cancellationSignal();
    // What a planner call's fetch is given: the caller's signal and its deadline.
    const modelCall = requestSignal(12_000);
    started.resolve();
    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(resolve, 5_000);
      caller?.addEventListener("abort", () => (clearTimeout(giveUp), resolve()), { once: true });
    });
    seen.push({ work: Boolean(caller?.aborted), modelCall: Boolean(modelCall?.aborted) });
    finished.resolve();
    return {};
  });

  const browser = new AbortController();
  const asked = request("/api/chat", { headers: owner, body: { message: "A long question?" } });
  const pending = POST(new Request(asked.url, { method: "POST", headers: asked.headers, body: await asked.text(), signal: browser.signal }));
  await started.promise;
  browser.abort();
  await pending;

  started = deferred();
  finished = deferred();
  const streamed = await POST(request("/api/chat", { headers: stream, body: { message: "Another long question?" } }));
  const reader = streamed.body!.getReader();
  await started.promise;
  await reader.cancel();
  await finished.promise;

  assert.deepEqual(seen, [
    { work: true, modelCall: true },
    { work: true, modelCall: true },
  ]);
});

async function failingWithNoCredit() {
  const harness = await workspace();
  const { ModelCallError } = await import("../src/lib/openai");
  const { adviseOnFailure } = await import("../src/lib/model-failure");
  const advice = adviseOnFailure({ status: 402 });
  harness.answerWith(async () => {
    throw new ModelCallError(advice, 402, "Insufficient credits");
  });
  const quiet = mock.method(console, "error", () => undefined);
  try {
    const streamed = await frames(await harness.ask(harness.stream, { message: "What is in these papers?" }));
    return { ...harness, advice, reply: streamed.at(-1) };
  } finally {
    quiet.mock.restore();
  }
}

test("a model failure is not dressed up as an answer, and its advice is kept with the reply", async () => {
  const { db, advice, reply } = await failingWithNoCredit();
  assert.equal(reply?.event, "result");
  assert.equal(reply?.data.mode, "fallback");
  assert.equal(reply?.data.groundingMode, "repository_unavailable");
  const stored = await db.query<{ limitations: string[] }>(
    `SELECT metadata->'repositoryLimitations' AS limitations FROM workspace_messages WHERE role = 'assistant'`
  );
  assert.deepEqual(stored.rows.map((row) => row.limitations), [[advice.message]]);
});

test("a reader whose account is out of credit is told so, not asked to retry", async () => {
  // An empty account is an account problem: retrying cannot help. The reply
  // joins the conversation like any other, in the failure's own words.
  const { db, advice, reply } = await failingWithNoCredit();
  assert.equal(advice.kind, "no_credit");
  assert.equal(reply?.event, "result");
  const answer = String(reply?.data.answer);
  assert.ok(answer.startsWith(advice.message), answer);
  assert.doesNotMatch(answer, /Please retry|could not access/);
  assert.deepEqual(reply?.data.limitations, [], "not blamed on the repository");
  const stored = await db.query<{ content: string; kind: string }>(
    `SELECT content, metadata->>'failureKind' AS kind FROM workspace_messages WHERE role = 'assistant'`
  );
  assert.deepEqual(stored.rows, [{ content: answer, kind: "no_credit" }]);
});
