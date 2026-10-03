/*
 * Stop, and the chat route's guard, run rather than read (docs/32, long-term
 * health). They replace text assertions in chat-cancel-registry. The chat and
 * cancel routes run as written against PGlite under the app's role
 * (tests/support/route-harness.ts); only the repository chat answers from a
 * script (stub-bootsec-repository-chat.ts).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryChatResult } from "../src/lib/repository-chat";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-bootsec-repository-chat.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const REQUEST_ID = "stop-test-0001";

async function chat() {
  const harness = await routeHarness({ APP_ALLOWED_ORIGINS: "https://papertrend.web.app" });
  const { clearVerifiedIdentities } = await import("../src/lib/auth/adapter");
  clearVerifiedIdentities();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  const { fallbackPromptPlan } = await import("../src/lib/repository-chat");
  const registry = await import("../src/lib/chat-cancel-registry");
  registry.resetCancelRegistry();
  globalThis.__bootsecRepositoryChatCalls = 0;
  const answer = (input: RepositoryChatInput): RepositoryChatResult => ({
    handled: true,
    answer: `Two papers answer "${input.prompt}".`,
    citations: [],
    charts: [],
    limitations: [],
    plan: fallbackPromptPlan(input.prompt, false),
    scopeSnapshot: { kind: "all_projects", label: "All projects", projectId: null, projectName: null, folderId: null, folderName: null, selectedRunCount: 0, eligiblePaperCount: 2 },
    diagnostics: { projectId: null, folderId: null, selectedRunCount: 0, paperCount: 2, versionHash: "v1", scopeLabel: "All projects" },
  });
  globalThis.__bootsecRepositoryChat = async (input) => answer(input);
  const route = await import("../src/app/api/chat/route");
  const cancel = await import("../src/app/api/chat/cancel/route");
  const stop = (headers: Record<string, string>, requestId: unknown = REQUEST_ID) => cancel.POST(harness.request("/api/chat/cancel", { headers, body: { requestId } }));
  const count = async (table: string) => (await harness.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return { ...harness, owner, other, route, cancel, stop, count, registry, answer };
}

test("the chat route refuses an unauthenticated caller before spending or saving anything", async () => {
  const { route, request, signIn, count } = await chat();
  const stranger = await signIn("00000000-0000-4000-8000-0000000000ee", { unmapped: true });
  const quiet = mock.method(console, "error", () => undefined);
  try {
    for (const headers of [{}, { authorization: "Bearer forged-token" }, stranger]) {
      for (const accept of ["application/json", "text/event-stream"]) {
        const response = await route.POST(request("/api/chat", { headers: { ...headers, accept }, body: { message: "What is in my papers?", webSearchEnabled: true } }));
        assert.equal(response.status, 401, `${JSON.stringify(headers)} ${accept}`);
      }
    }
  } finally {
    quiet.mock.restore();
  }
  assert.equal(globalThis.__bootsecRepositoryChatCalls, 0, "no answer was started");
  assert.equal(await count("workspace_threads"), 0);
  assert.equal(await count("workspace_messages"), 0);
  assert.equal(await count("ai_usage_events"), 0);
});

test("Stop, naming the request's id, stops that reader's answer and nobody else's, and saves no half answer", async () => {
  const { route, request, owner, other, stop, registry, db } = await chat();
  const { cancellationSignal } = await import("../src/lib/chat-cancellation");
  const { ModelCallError } = await import("../src/lib/openai");
  const { adviseOnFailure } = await import("../src/lib/model-failure");
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  let stoppedBy: "stop" | "time" | null = null;
  globalThis.__bootsecRepositoryChat = async () => {
    const signal = cancellationSignal();
    started();
    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(() => ((stoppedBy = "time"), resolve()), 5_000);
      signal?.addEventListener("abort", () => (clearTimeout(giveUp), (stoppedBy = "stop"), resolve()), { once: true });
    });
    // What a model call does when its caller's signal aborts.
    throw new ModelCallError(adviseOnFailure({ aborted: true }), undefined, "This operation was aborted");
  };
  const streamed = await route.POST(
    request("/api/chat", { headers: { ...owner, accept: "text/event-stream", "x-chat-request-id": REQUEST_ID }, body: { message: "Summarise every paper in detail" } })
  );
  const body = streamed.text();
  await running;
  assert.equal(registry.liveRequestCount(), 1, "the answer is registered under its id while it runs");

  assert.equal((await stop({})).status, 401, "nobody signed in can stop it");
  assert.deepEqual(await (await stop(other)).json(), { cancelled: false }, "another reader cannot stop it");
  assert.equal((await stop(owner, "has spaces")).status, 400);
  assert.equal(stoppedBy, null, "still running");
  const quiet = mock.method(console, "error", () => undefined);
  let text: string;
  try {
    assert.deepEqual(await (await stop(owner)).json(), { cancelled: true });
    text = await body;
  } finally {
    quiet.mock.restore();
  }
  const frames = text.split("\n\n").filter((frame) => frame.startsWith("event: "));
  assert.equal(stoppedBy, "stop");
  assert.match(frames.at(-1) ?? "", /Stopped at your request/);
  assert.equal(registry.liveRequestCount(), 0, "a finished answer is no longer held");
  assert.deepEqual(await (await stop(owner)).json(), { cancelled: false }, "stopping a finished answer is not an error");

  // The question stays; no answer was written, only the note that it was stopped.
  const messages = await db.query<{ role: string; content: string }>(`SELECT role, content FROM workspace_messages ORDER BY created_at`);
  assert.deepEqual(messages.rows.map((row) => row.role), ["user", "assistant"]);
  assert.equal(messages.rows[0].content, "Summarise every paper in detail");
  assert.match(messages.rows[1].content, /^Stopped at your request\. No answer was written\. \(Request ID `[^`]+`\.\)$/);
});

test("a browser on the site may send the id Stop names, across origins", async () => {
  const { route, cancel } = await chat();
  for (const preflight of [route.OPTIONS, cancel.OPTIONS]) {
    const response = await preflight(new Request("https://papertrend-web.run.app/api/chat", { method: "OPTIONS", headers: { origin: "https://papertrend.web.app" } }));
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-Chat-Request-Id/);
  }
});
