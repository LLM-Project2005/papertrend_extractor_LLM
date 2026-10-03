/*
 * Stopping an answer, and timing its model calls. The scopes are run on their
 * own, then through the chat route against PGlite under the app's role
 * (tests/support/route-harness.ts), with the repository chat answering from a
 * script (stub-chatscope-repository-chat.ts).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryChatResult } from "../src/lib/repository-chat";
import { routeHarness, stubModule } from "./support/route-harness";
import {
  ChatCancelledError,
  cancellationSignal,
  isCancelled,
  requestSignal,
  runWithCancellation,
  throwIfCancelled,
} from "../src/lib/chat-cancellation";
import {
  recordModelCallLatency,
  runWithModelLatency,
  summarizeModelLatency,
} from "../src/lib/model-latency";

stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-chatscope-repository-chat.ts", import.meta.url).href);

test("no signal is in scope outside a request", () => {
  assert.equal(cancellationSignal(), undefined);
  assert.equal(isCancelled(), false);
  assert.doesNotThrow(() => throwIfCancelled());
});

test("the caller's signal reaches work inside the request", async () => {
  const controller = new AbortController();
  await runWithCancellation(controller.signal, async () => {
    assert.equal(cancellationSignal(), controller.signal);
    assert.equal(isCancelled(), false);
    controller.abort();
    assert.equal(isCancelled(), true);
  });
});

test("cancelled work stops at the next safe point", async () => {
  const controller = new AbortController();
  controller.abort();
  await runWithCancellation(controller.signal, async () => {
    assert.throws(() => throwIfCancelled(), ChatCancelledError);
  });
});

test("a live request is never stopped by mistake", async () => {
  const controller = new AbortController();
  await runWithCancellation(controller.signal, async () => {
    assert.doesNotThrow(() => throwIfCancelled());
  });
});

test("the caller's signal is combined with a timeout", async () => {
  const controller = new AbortController();
  await runWithCancellation(controller.signal, async () => {
    const combined = requestSignal(60_000);
    assert.ok(combined);
    assert.equal(combined!.aborted, false);
    controller.abort();
    // Aborting the caller must abort the combined signal, not just the timeout.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(combined!.aborted, true);
  });
});

test("a timeout alone still works outside a request", () => {
  const combined = requestSignal(5_000);
  assert.ok(combined);
  assert.equal(combined!.aborted, false);
});

test("no signal and no timeout means no abort", () => {
  assert.equal(requestSignal(undefined), undefined);
});

test("model call latency is recorded per task", async () => {
  const { value, timings } = await runWithModelLatency(async () => {
    recordModelCallLatency("CHAT_SYNTHESIS", 6_500, "ok");
    recordModelCallLatency("CHAT_FAITHFULNESS", 4_300, "ok");
    recordModelCallLatency("CHAT_SYNTHESIS", 1_200, "failed");
    return "answer";
  });
  assert.equal(value, "answer");
  assert.equal(timings.length, 3);
  const summary = summarizeModelLatency(timings);
  assert.equal(summary.callCount, 3);
  assert.equal(summary.totalMs, 12_000);
  // Slowest task first, so a log line leads with what to tune.
  assert.equal(summary.byTask[0].task, "CHAT_SYNTHESIS");
  assert.equal(summary.byTask[0].calls, 2);
  assert.equal(summary.byTask[0].totalMs, 7_700);
});

test("recording outside a request is a harmless no-op", () => {
  assert.doesNotThrow(() => recordModelCallLatency("CHAT_SYNTHESIS", 100, "ok"));
});

test("an unnamed call is still attributed rather than dropped", async () => {
  const { timings } = await runWithModelLatency(async () => {
    recordModelCallLatency(undefined, 900, "ok");
  });
  assert.equal(summarizeModelLatency(timings).byTask[0].task, "unnamed");
});

test("an empty request summarises to zero rather than failing", () => {
  const summary = summarizeModelLatency([]);
  assert.equal(summary.callCount, 0);
  assert.equal(summary.totalMs, 0);
  assert.deepEqual(summary.byTask, []);
});

/* --------------------------------------------------------- through the route */

const OWNER = "00000000-0000-4000-8000-00000000000a";

type Seen = { signal: AbortSignal | undefined };

/** The chat route, signed in, with each answer's work scripted by `work`. */
async function chat(work: (seen: Seen) => Promise<void>) {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const { fallbackPromptPlan } = await import("../src/lib/repository-chat");
  globalThis.__chatScopeRepositoryChat = async (input: RepositoryChatInput) => {
    await work({ signal: cancellationSignal() });
    return {
      handled: true,
      answer: "Two papers answer it.",
      citations: [],
      charts: [],
      limitations: [],
      plan: fallbackPromptPlan(input.prompt, false),
      scopeSnapshot: { kind: "all_projects", label: "All projects", projectId: null, projectName: null, folderId: null, folderName: null, selectedRunCount: 0, eligiblePaperCount: 2 },
      diagnostics: { projectId: null, folderId: null, selectedRunCount: 0, paperCount: 2, versionHash: "v1", scopeLabel: "All projects" },
    } as RepositoryChatResult;
  };
  const { POST } = await import("../src/app/api/chat/route");
  /** Asks, with the browser's own signal; `stream` asks for Server-Sent Events. */
  const ask = (message: string, options: { stream?: boolean; signal?: AbortSignal } = {}) => {
    const headers = { ...owner, ...(options.stream ? { accept: "text/event-stream" } : {}) };
    const asked = harness.request("/api/chat", { headers, body: { message } });
    return asked.text().then((body) => POST(new Request(asked.url, { method: "POST", headers: asked.headers, body, signal: options.signal })));
  };
  return { ask };
}

/** The chat_model_latency lines the route logged while `work` ran. */
async function latencyLogs(work: () => Promise<unknown>) {
  const lines: Array<{ callCount: number; totalMs: number; cancelled: boolean }> = [];
  const info = mock.method(console, "info", (label: unknown, payload: unknown) => {
    if (label === "chat_model_latency") lines.push(JSON.parse(String(payload)));
  });
  try {
    await work();
  } finally {
    info.mock.restore();
  }
  return lines;
}

/** Waits for the work to start, stops it the way `stop` says, and reports what the work saw. */
function stoppable() {
  let started!: () => void;
  const start = new Promise<void>((resolve) => (started = resolve));
  const seen: boolean[] = [];
  const work = async ({ signal }: Seen) => {
    started();
    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(resolve, 5_000);
      signal?.addEventListener("abort", () => (clearTimeout(giveUp), resolve()), { once: true });
    });
    recordModelCallLatency("CHAT_SYNTHESIS", 2_000, "failed");
    seen.push(Boolean(signal?.aborted));
  };
  return { start, seen, work };
}

test("the streaming path installs its scopes inside the stream callback", async () => {
  // The streaming Response is returned before any work runs, so wrapping the
  // call that creates it left the real work outside both scopes: latency was
  // always empty and cancellation never reached a model call.
  let signal: AbortSignal | undefined;
  const { ask } = await chat(async (seen) => {
    signal = seen.signal;
    recordModelCallLatency("CHAT_SYNTHESIS", 6_500, "ok");
  });
  const logs = await latencyLogs(async () => (await ask("What are the main topics?", { stream: true })).text());
  assert.ok(signal, "the work has a signal to stop on");
  assert.deepEqual(logs.map(({ callCount, totalMs, cancelled }) => ({ callCount, totalMs, cancelled })), [{ callCount: 1, totalMs: 6_500, cancelled: false }]);
});

test("the non-streaming path keeps its own scopes", async () => {
  const run = stoppable();
  const { ask } = await chat(run.work);
  const browser = new AbortController();
  const logs = await latencyLogs(async () => {
    const answered = ask("A long question?", { signal: browser.signal });
    await run.start;
    browser.abort();
    await answered;
  });
  assert.deepEqual(run.seen, [true], "the work stops when the request does");
  assert.deepEqual(logs.map(({ callCount, cancelled }) => ({ callCount, cancelled })), [{ callCount: 1, cancelled: true }]);
});

test("a disconnect is caught whether the signal aborts or the stream is cancelled", async (t) => {
  // Behind the Cloud Run proxy the request signal did not always fire, so Stop
  // aborted the browser's fetch while the server finished the answer in private
  // and paid for every remaining model call.
  const quiet = mock.method(console, "info", () => undefined);
  t.after(() => quiet.mock.restore());
  const bySignal = stoppable();
  const first = await chat(bySignal.work);
  const browser = new AbortController();
  const streamed = await first.ask("A long question?", { stream: true, signal: browser.signal });
  const drained = streamed.text().catch(() => "");
  await bySignal.start;
  browser.abort();
  await drained;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(bySignal.seen, [true], "the request's signal");

  const byReader = stoppable();
  const second = await chat(byReader.work);
  const reader = (await second.ask("Another long question?", { stream: true })).body!.getReader();
  await byReader.start;
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(byReader.seen, [true], "the reader leaving the stream");
});

test("the work and the log both follow the combined signal, not the request alone", async () => {
  // A log that reads request.signal would report cancelled:false for a stream
  // cancellation, hiding exactly the case this guards against.
  const run = stoppable();
  const { ask } = await chat(run.work);
  const logs = await latencyLogs(async () => {
    const reader = (await ask("A long question?", { stream: true })).body!.getReader();
    await run.start;
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.deepEqual(run.seen, [true]);
  assert.deepEqual(logs.map(({ cancelled }) => cancelled), [true]);
});

test("both disconnect paths abort the combined signal", () => {
  for (const abortWhich of ["request", "reader"] as const) {
    const requestSide = new AbortController();
    const readerLeft = new AbortController();
    const disconnected = AbortSignal.any([requestSide.signal, readerLeft.signal]);
    assert.equal(disconnected.aborted, false);
    (abortWhich === "request" ? requestSide : readerLeft).abort();
    assert.equal(disconnected.aborted, true, `${abortWhich} disconnect must abort`);
  }
});
