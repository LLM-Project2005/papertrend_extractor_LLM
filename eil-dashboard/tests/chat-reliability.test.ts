import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CACHE_TTL_MS,
  MAX_ENTRIES,
  cacheKey,
  cachedAnswerCount,
  normalizeQuestion,
  readAnswerCache,
  resetAnswerCache,
  writeAnswerCache,
} from "../src/lib/answer-cache";
import {
  adviseOnFailure,
  backoffMs,
  classifyFailure,
  isTransient,
  type FailureKind,
} from "../src/lib/model-failure";
import { costOfCall, formatUsd, isPricedModel, summarizeSpend } from "../src/lib/answer-cost";

function server(file: string): string {
  return readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
}

const KEY = {
  ownerUserId: "user-1",
  versionHash: "v1",
  scopeKey: "project-1||",
  question: "What are the main topics?",
};

/* ------------------------------------------------------------- failure advice */

test("each failure class gets its own message and its own advice", () => {
  // The acceptance criterion: every error path names what failed and what to do
  // next. One generic sentence told a reader nothing about whether to wait,
  // shorten the question, or tell the owner the account is empty.
  const kinds: FailureKind[] = [
    "no_credit",
    "rate_limited",
    "provider_error",
    "timeout",
    "cancelled",
    "unauthorized",
    "too_long",
    "unknown",
  ];
  // Each kind reached through an input that genuinely classifies as it, so the
  // test cannot pass by asking for a kind directly.
  const messages = kinds.map((kind) => adviseOnFailureForKind(kind));
  for (const [index, message] of messages.entries()) {
    assert.ok(message.length > 30, `${kinds[index]} has no real message`);
  }
  assert.equal(new Set(messages).size, kinds.length, "two kinds share a message");
});

function adviseOnFailureForKind(kind: FailureKind): string {
  const inputs: Record<FailureKind, Parameters<typeof adviseOnFailure>[0]> = {
    no_credit: { status: 402 },
    rate_limited: { status: 429 },
    provider_error: { status: 503 },
    timeout: { message: "request timed out" },
    cancelled: { aborted: true },
    unauthorized: { status: 401 },
    too_long: { status: 413 },
    unknown: { status: 400, message: "something odd" },
  };
  const advice = adviseOnFailure(inputs[kind]);
  assert.equal(advice.kind, kind, `${kind} was classified as ${advice.kind}`);
  return advice.message;
}

test("an empty account is named as an account problem, not the reader's fault", () => {
  // This project ran to within twenty cents of an empty balance with nothing
  // saying so. A reader shortening their question would not have helped.
  const advice = adviseOnFailure({ status: 402 });
  assert.equal(advice.kind, "no_credit");
  assert.match(advice.message, /credit/i);
  assert.match(advice.message, /account-level problem rather than anything about your question/i);
  assert.equal(advice.retryable, false);
});

test("a provider message is classified even without a status code", () => {
  assert.equal(classifyFailure({ message: "Insufficient credits for this request" }), "no_credit");
  assert.equal(classifyFailure({ message: "Rate limit exceeded" }), "rate_limited");
  assert.equal(classifyFailure({ message: "maximum context length is 128000 tokens" }), "too_long");
  assert.equal(classifyFailure({ message: "fetch failed" }), "provider_error");
  assert.equal(classifyFailure({ message: "ETIMEDOUT" }), "timeout");
});

test("the reader stopping it is never reported as an error", () => {
  const advice = adviseOnFailure({ aborted: true, message: "The operation was aborted" });
  assert.equal(advice.kind, "cancelled");
  assert.match(advice.message, /Stopped at your request/);
});

/* --------------------------------------------------------------- the retry */

test("only a plausibly transient failure is retried", () => {
  // Retrying a refusal doubles the wait before the same outcome.
  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient({ message: "timed out" }), true);

  assert.equal(isTransient({ status: 402 }), false, "an empty account is not transient");
  assert.equal(isTransient({ status: 401 }), false);
  assert.equal(isTransient({ status: 413 }), false);
  assert.equal(isTransient({ aborted: true }), false, "the reader leaving is not transient");
});

test("rate limiting waits longer than a dropped connection", () => {
  // Retrying a 429 after 300ms usually earns another 429.
  assert.ok(backoffMs("rate_limited", 0) > backoffMs("provider_error", 1));
  assert.ok(backoffMs("provider_error", 0) >= 600);
});

test("the model call retries once, and only once", () => {
  const source = server("lib/openai.ts");
  assert.match(source, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  // A reader who has gone away must not be retried into.
  assert.match(source, /if \(cancellationSignal\(\)\?\.aborted \|\| !isTransient\(lastFailure\)\) break;/);
});

test("a failed call still carries its advice to the route", () => {
  const source = server("lib/openai.ts");
  assert.match(source, /export class ModelCallError/);
  assert.match(source, /throw new ModelCallError\(advice/);
  const route = server("app/api/chat/route.ts");
  assert.match(route, /error instanceof ModelCallError\s*\?\s*error\.advice/);
});

/* ----------------------------------------------------------------- the cost */

test("a token count becomes a cost, per model", () => {
  // The same 20,000 tokens is a fraction of a cent on the fast model and
  // several cents on the reader-facing one, and an answer uses both.
  const expensive = costOfCall("openai/gpt-5.6-luna-20260709", 10_000, 2_000);
  const cheap = costOfCall("google/gemini-3.7-flash", 10_000, 2_000);
  assert.ok(expensive > cheap * 10, `${expensive} vs ${cheap}`);
  assert.equal(costOfCall("google/gemini-3.7-flash", 0, 0), 0);
});

test("an unknown model is priced high rather than free", () => {
  // A cost that is too high prompts someone to look; one that is too low does not.
  assert.equal(isPricedModel("some/new-model"), false);
  assert.ok(costOfCall("some/new-model", 100_000, 10_000) > 0.2);
});

test("a whole answer's spend is broken down by the models that served it", () => {
  const spend = summarizeSpend([
    { model: "openai/gpt-5.6-luna-20260709", promptTokens: 8_000, completionTokens: 900 },
    { model: "google/gemini-3.7-flash", promptTokens: 6_000, completionTokens: 400 },
    { model: "google/gemini-3.7-flash", promptTokens: 3_000, completionTokens: 300 },
  ]);
  assert.equal(spend.byModel.length, 2);
  // Most expensive first, so a log line leads with what to tune.
  assert.equal(spend.byModel[0].model, "openai/gpt-5.6-luna-20260709");
  assert.ok(spend.usd > 0);
  assert.deepEqual(spend.unpricedModels, []);
});

test("an unpriced model is named rather than silently guessed at", () => {
  const spend = summarizeSpend([{ model: "mystery/model", promptTokens: 1_000, completionTokens: 100 }]);
  assert.deepEqual(spend.unpricedModels, ["mystery/model"]);
});

test("a cost under a cent is not rounded away to zero", () => {
  // The fast model's calls genuinely cost fractions of a cent, and rounding
  // those to zero would make a running total drift low.
  const tiny = costOfCall("google/gemini-3.7-flash", 1_000, 100);
  assert.ok(tiny > 0, "a real call must not cost zero");
  assert.match(formatUsd(tiny), /^\$0\.\d{4}$/);
  assert.equal(formatUsd(1.234), "$1.23");
  assert.equal(formatUsd(0), "$0.00");
});

test("the streaming path records its own spend, where the work happens", () => {
  // The Response is returned before any model call runs, so the usage scope
  // wrapping it was always empty - and the UI streams, which meant in practice
  // no answer's cost was ever recorded.
  const route = server("app/api/chat/route.ts");
  const start = route.indexOf("async start(controller)");
  const end = route.indexOf("return new Response(stream");
  const inside = route.slice(start, end);
  assert.match(inside, /withAiTokenUsageTracking/);
  assert.match(inside, /recordAnswerSpend\(request, usage\)/);
});

test("both paths record through the same function", () => {
  const route = server("app/api/chat/route.ts");
  const uses = route.match(/recordAnswerSpend\(request, usage\)/g) ?? [];
  assert.equal(uses.length, 2, `only ${uses.length} path(s) record spend`);
});

test("failing to record the cost never fails the answer", () => {
  // The reader asked a question, not for bookkeeping.
  const route = server("app/api/chat/route.ts");
  const fn = route.slice(route.indexOf("async function recordAnswerSpend"));
  assert.match(fn.slice(0, 1200), /try \{/);
  assert.match(fn.slice(0, 1200), /catch \(error\)/);
});

/* ---------------------------------------------------------------- the cache */

test.beforeEach(() => resetAnswerCache());

test("an identical question comes back from the cache", () => {
  writeAnswerCache(KEY, { answer: "Five papers.", citations: [], charts: [], limitations: [] });
  const hit = readAnswerCache(KEY);
  assert.ok(hit);
  assert.equal(hit!.answer, "Five papers.");
});

test("a changed repository never serves a stale answer", () => {
  // The property that makes this safe: adding, removing or re-analysing a paper
  // changes the version hash, so the old answer is unreachable rather than
  // wrong.
  writeAnswerCache(KEY, { answer: "Five papers.", citations: [], charts: [], limitations: [] });
  assert.equal(readAnswerCache({ ...KEY, versionHash: "v2" }), null);
});

test("a different scope, owner or question misses", () => {
  writeAnswerCache(KEY, { answer: "Five papers.", citations: [], charts: [], limitations: [] });
  assert.equal(readAnswerCache({ ...KEY, ownerUserId: "user-2" }), null);
  assert.equal(readAnswerCache({ ...KEY, scopeKey: "project-2||" }), null);
  assert.equal(readAnswerCache({ ...KEY, question: "Something else entirely?" }), null);
});

test("spacing and case do not make a new question", () => {
  writeAnswerCache(KEY, { answer: "Five papers.", citations: [], charts: [], limitations: [] });
  assert.ok(readAnswerCache({ ...KEY, question: "  what are the MAIN topics?  " }));
  assert.equal(normalizeQuestion("  A  B  "), "a b");
});

test("one word of difference is a different question", () => {
  // Serving the wrong cached answer is far worse than missing the cache, so the
  // normaliser deliberately does not stem, reorder or drop words.
  writeAnswerCache(KEY, { answer: "Five papers.", citations: [], charts: [], limitations: [] });
  assert.equal(readAnswerCache({ ...KEY, question: "What are the main methods?" }), null);
  assert.notEqual(cacheKey(KEY), cacheKey({ ...KEY, question: "What are the main methods?" }));
});

test("an entry expires rather than serving an answer forever", () => {
  const start = 1_000_000;
  writeAnswerCache(KEY, { answer: "Five papers.", citations: [], charts: [], limitations: [] }, start);
  assert.ok(readAnswerCache(KEY, start + CACHE_TTL_MS - 1));
  assert.equal(readAnswerCache(KEY, start + CACHE_TTL_MS + 1), null);
});

test("an empty answer is never cached", () => {
  // It would serve the failure to everyone asking the same thing for half an hour.
  writeAnswerCache(KEY, { answer: "   ", citations: [], charts: [], limitations: [] });
  assert.equal(readAnswerCache(KEY), null);
});

test("the cache is bounded", () => {
  const start = 1_000_000;
  for (let index = 0; index < MAX_ENTRIES + 50; index += 1) {
    writeAnswerCache(
      { ...KEY, question: `question number ${index}` },
      { answer: `answer ${index}`, citations: [], charts: [], limitations: [] },
      start + index
    );
  }
  assert.ok(cachedAnswerCount(start + MAX_ENTRIES) <= MAX_ENTRIES);
});

test("a follow-up is never answered from the cache", () => {
  // A follow-up means something different depending on what came before it.
  const chat = server("lib/repository-chat.ts");
  assert.match(chat, /const cacheable = \(input\.history\?\.length \?\? 0\) === 0 && !input\.forceChart;/);
});

test("a deferred answer is not cached as if it were the answer", () => {
  // A 202 carries a job id, not an answer.
  const chat = server("lib/repository-chat.ts");
  assert.match(chat, /if \(cacheable && result\.handled && !result\.jobId && result\.answer\.trim\(\)\)/);
});

test("a cached answer says so", () => {
  const chat = server("lib/repository-chat.ts");
  assert.match(chat, /cached: true/);
  assert.match(chat, /chat_cache_hit/);
});

/* ------------------------------------------ a forced failure, actually forced */

/**
 * The acceptance criterion is that a single model failure still produces a
 * usable answer. Asserting the retry loop exists is not that: it proves the
 * code was written. These force a failure through `fetch` and check what comes
 * back.
 */
async function withStubbedFetch<T>(
  responses: Array<() => Promise<Response> | Response>,
  run: () => Promise<T>
): Promise<{ value: T; calls: number }> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return next();
  }) as typeof fetch;
  try {
    return { value: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

function completion(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      model: "google/gemini-3.7-flash",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

test("one transient failure still produces an answer", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const { createChatCompletionResult } = await import("../src/lib/openai");

  const { value, calls } = await withStubbedFetch(
    [() => new Response("upstream exploded", { status: 503 }), () => completion("The answer.")],
    () => createChatCompletionResult([{ role: "user", content: "hi" }], 0, undefined, "CHAT_SYNTHESIS")
  );

  assert.equal(calls, 2, "the failed call was not retried");
  assert.equal(value?.content, "The answer.");
});

test("a refusal is not retried, and explains itself", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const { createChatCompletionResult, ModelCallError } = await import("../src/lib/openai");

  let thrown: unknown = null;
  const { calls } = await withStubbedFetch(
    [() => new Response("Insufficient credits", { status: 402 })],
    async () => {
      try {
        await createChatCompletionResult([{ role: "user", content: "hi" }], 0, undefined, "CHAT_SYNTHESIS");
      } catch (error) {
        thrown = error;
      }
    }
  );

  assert.equal(calls, 1, "an empty account was retried, doubling the wait for the same outcome");
  assert.ok(thrown instanceof ModelCallError);
  assert.equal((thrown as InstanceType<typeof ModelCallError>).advice.kind, "no_credit");
});

test("both attempts failing reports the failure rather than hanging", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const { createChatCompletionResult, ModelCallError } = await import("../src/lib/openai");

  let thrown: unknown = null;
  const { calls } = await withStubbedFetch(
    [() => new Response("still down", { status: 502 })],
    async () => {
      try {
        await createChatCompletionResult([{ role: "user", content: "hi" }], 0, undefined, "CHAT_RERANK");
      } catch (error) {
        thrown = error;
      }
    }
  );

  assert.equal(calls, 2);
  assert.ok(thrown instanceof ModelCallError);
  assert.equal((thrown as InstanceType<typeof ModelCallError>).advice.kind, "provider_error");
  assert.equal((thrown as InstanceType<typeof ModelCallError>).advice.retryable, true);
});

test("a step that can degrade still degrades rather than failing the answer", () => {
  // The retry buys one more chance; when it is used up, reranking falls back to
  // deterministic fusion and the answer still arrives. This is what makes a
  // single failure survivable end to end.
  const chat = server("lib/repository-chat.ts");
  const rerank = chat.slice(chat.indexOf('"CHAT_RERANK"'));
  assert.match(rerank.slice(0, 900), /catch \{[\s\S]*Deterministic reciprocal-rank fusion remains the fallback/);
});
