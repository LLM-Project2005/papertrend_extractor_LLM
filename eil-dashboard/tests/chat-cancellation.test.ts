import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("the streaming path installs its scopes inside the stream callback", () => {
  // The streaming Response is returned before any work runs, so wrapping the
  // call that creates it left the real work outside both scopes: latency was
  // always empty and cancellation never reached a model call.
  const route = readFileSync(
    new URL("../src/app/api/chat/route.ts", import.meta.url),
    "utf8"
  );
  const startIndex = route.indexOf("async start(controller)");
  const endIndex = route.indexOf("return new Response(stream");
  assert.ok(startIndex > 0 && endIndex > startIndex, "stream callback not found");
  const inside = route.slice(startIndex, endIndex);
  // The combined disconnect signal, not request.signal alone; see below.
  assert.match(inside, /runWithCancellation\(disconnected,/);
  assert.match(inside, /runWithModelLatency/);
});

test("the non-streaming path keeps its own scopes", () => {
  const route = readFileSync(
    new URL("../src/app/api/chat/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /runWithCancellation\(request\.signal, \(\) => handlePost\(request\)\)/);
});

test("a disconnect is caught whether the signal aborts or the stream is cancelled", () => {
  // Behind the Cloud Run proxy the request signal did not always fire, so Stop
  // aborted the browser's fetch while the server finished the answer in private
  // and paid for every remaining model call.
  const route = readFileSync(
    new URL("../src/app/api/chat/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /const readerLeft = new AbortController\(\)/);
  assert.match(route, /AbortSignal\.any\(\[request\.signal, readerLeft\.signal\]\)/);
  assert.match(route, /cancel\(\) \{[\s\S]*readerLeft\.abort\(\)/);
});

test("the work and the log both follow the combined signal, not the request alone", () => {
  const route = readFileSync(
    new URL("../src/app/api/chat/route.ts", import.meta.url),
    "utf8"
  );
  // A log that reads request.signal would report cancelled:false for a stream
  // cancellation, hiding exactly the case this guards against.
  assert.match(route, /runWithCancellation\(disconnected,/);
  assert.match(route, /cancelled: disconnected\.aborted/);
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
