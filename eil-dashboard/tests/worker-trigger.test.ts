/*
 * Waking the analysis worker, run rather than read (docs/32, long-term
 * health): the request it sends, what it reports when the worker is cold,
 * down or misconfigured, and the bounds on what it asks for.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.WORKER_SERVICE_URL = "https://worker.papertrend.test/";
process.env.WORKER_WEBHOOK_SECRET = "webhook-secret-for-tests";
delete process.env.K_SERVICE;
delete process.env.GOOGLE_CLOUD_PROJECT_ID;

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a worker that does not answer within 20 seconds is reported as a timeout, not left waiting", async () => {
  const { triggerWorkerQueue } = await import("../src/lib/worker-trigger");
  mock.timers.enable({ apis: ["setTimeout"] });
  const worker = stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
      })
  );
  try {
    let done = false;
    const pending = triggerWorkerQueue({ maxRuns: 9, reason: "upload" }).then((result) => {
      done = true;
      return result;
    });
    await settle();
    mock.timers.tick(19_999);
    await settle();
    assert.equal(done, false, "still waiting just before the limit");
    mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.started, false);
    assert.equal(result.status, 0);
    assert.equal(result.payload.reason, "worker_request_timeout");

    const [call] = worker.calls;
    assert.equal(call.url, "https://worker.papertrend.test/process-queue");
    assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer webhook-secret-for-tests");
    assert.deepEqual(JSON.parse(String(call.init.body)), { async: true, maxRuns: 5, reason: "upload", force: false }, "at most 5 runs a call");
  } finally {
    mock.timers.reset();
    worker.restore();
  }
});

test("a worker that is down or refuses is reported; only an accepted start counts as started", async () => {
  const { triggerWorkerQueue } = await import("../src/lib/worker-trigger");
  const cases: Array<[() => Promise<Response>, { started: boolean; status: number; reason?: string }]> = [
    [() => Promise.reject(new TypeError("fetch failed")), { started: false, status: 0, reason: "worker_request_failed" }],
    [() => Promise.resolve(json({ queued: true })), { started: true, status: 200 }],
    [() => Promise.resolve(json({ ok: true })), { started: true, status: 200 }],
    [() => Promise.resolve(json({ queued: false, already_running: true })), { started: false, status: 200 }],
    [() => Promise.resolve(json({ error: "busy" }, 503)), { started: false, status: 503 }],
    [() => Promise.resolve(new Response("not json", { status: 200 })), { started: true, status: 200 }],
  ];
  for (const [answer, expected] of cases) {
    const worker = stubFetch(answer);
    try {
      const result = await triggerWorkerQueue();
      assert.equal(result.started, expected.started, JSON.stringify(expected));
      assert.equal(result.status, expected.status);
      if (expected.reason) assert.equal(result.payload.reason, expected.reason);
      assert.deepEqual(JSON.parse(String(worker.calls[0].init.body)), { async: true, maxRuns: 1, reason: "api-trigger", force: false });
    } finally {
      worker.restore();
    }
  }
});

test("with no worker address or credential, nothing is sent", async () => {
  const { triggerWorkerQueue } = await import("../src/lib/worker-trigger");
  const worker = stubFetch(() => Promise.resolve(json({})));
  const saved = { ...process.env };
  try {
    process.env.WORKER_SERVICE_URL = "";
    delete process.env.PYTHON_NODE_SERVICE_URL;
    assert.deepEqual((await triggerWorkerQueue()).payload, { skipped: true, reason: "missing_worker_config" });
    process.env.WORKER_SERVICE_URL = "https://worker.papertrend.test";
    delete process.env.WORKER_WEBHOOK_SECRET;
    delete process.env.CRON_SECRET;
    assert.deepEqual((await triggerWorkerQueue()).payload, { skipped: true, reason: "missing_worker_auth" });
    assert.equal(worker.calls.length, 0);
  } finally {
    process.env.WORKER_SERVICE_URL = saved.WORKER_SERVICE_URL;
    process.env.WORKER_WEBHOOK_SECRET = saved.WORKER_WEBHOOK_SECRET;
    worker.restore();
  }
});

test("queueing worker tasks asks for between 1 and 50 tasks of 1 to 5 runs, and counts only an enqueued answer", async () => {
  const { enqueueWorkerQueueTasks } = await import("../src/lib/worker-trigger");
  for (const [options, body] of [
    [{ taskCount: 0, maxRuns: 0 }, { taskCount: 1, maxRuns: 1 }],
    [{ taskCount: 500, maxRuns: 99 }, { taskCount: 50, maxRuns: 5 }],
    [{ taskCount: 7, maxRuns: 3, reason: "finalize", force: true }, { taskCount: 7, maxRuns: 3, reason: "finalize", force: true }],
  ] as const) {
    const worker = stubFetch(() => Promise.resolve(json({ enqueued: true, tasks: 1 })));
    try {
      const result = await enqueueWorkerQueueTasks(options);
      assert.equal(worker.calls[0].url, "https://worker.papertrend.test/enqueue-ingestion-tasks");
      assert.deepEqual(JSON.parse(String(worker.calls[0].init.body)), { reason: "api-cloud-task-trigger", force: false, ...body });
      assert.equal(result.started, true);
      assert.equal(result.payload.trigger_kind, "cloud_tasks");
    } finally {
      worker.restore();
    }
  }
  const refused = stubFetch(() => Promise.resolve(json({ enqueued: false })));
  try {
    assert.equal((await enqueueWorkerQueueTasks()).started, false);
  } finally {
    refused.restore();
  }
});
