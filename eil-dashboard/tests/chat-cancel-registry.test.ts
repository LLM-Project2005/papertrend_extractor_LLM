import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  cancelRequest,
  isValidRequestId,
  liveRequestCount,
  registerCancellable,
  resetCancelRegistry,
} from "../src/lib/chat-cancel-registry";
import { newChatRequestId } from "../src/lib/chat-http";

test.beforeEach(() => resetCancelRegistry());

test("a registered request can be stopped by name", () => {
  // Measured on the pilot: a reader who disconnected 0.6s in still had all five
  // model calls run to completion, 25.0s of model time. Stop must say so.
  const controller = new AbortController();
  registerCancellable("user-1", "req-1234", controller);
  assert.equal(controller.signal.aborted, false);
  assert.equal(cancelRequest("user-1", "req-1234"), true);
  assert.equal(controller.signal.aborted, true);
});

test("one reader cannot stop another reader's answer", () => {
  const controller = new AbortController();
  registerCancellable("user-1", "req-1234", controller);
  assert.equal(cancelRequest("user-2", "req-1234"), false);
  assert.equal(controller.signal.aborted, false, "another user's answer must keep running");
});

test("cancelling an answer that already finished is not an error", () => {
  assert.equal(cancelRequest("user-1", "req-unknown"), false);
});

test("a finished request stops being cancellable", () => {
  const controller = new AbortController();
  const unregister = registerCancellable("user-1", "req-1234", controller);
  unregister();
  assert.equal(cancelRequest("user-1", "req-1234"), false);
  assert.equal(liveRequestCount(), 0);
});

test("cancelling twice aborts once and then reports nothing to do", () => {
  const controller = new AbortController();
  registerCancellable("user-1", "req-1234", controller);
  assert.equal(cancelRequest("user-1", "req-1234"), true);
  assert.equal(cancelRequest("user-1", "req-1234"), false);
});

test("an abandoned request expires instead of leaking", () => {
  const start = 1_000_000;
  registerCancellable("user-1", "req-1234", new AbortController(), start);
  assert.equal(liveRequestCount(start), 1);
  // Past the five-minute lifetime.
  assert.equal(liveRequestCount(start + 6 * 60_000), 0);
  assert.equal(cancelRequest("user-1", "req-1234", start + 6 * 60_000), false);
});

test("a runaway client cannot pin unbounded memory", () => {
  const start = 1_000_000;
  for (let index = 0; index < 600; index += 1) {
    registerCancellable("user-1", `req-${index.toString().padStart(8, "0")}`, new AbortController(), start);
  }
  assert.ok(liveRequestCount(start) <= 500, `registry grew to ${liveRequestCount(start)}`);
});

test("the newest request stays cancellable when the registry is full", () => {
  const start = 1_000_000;
  for (let index = 0; index < 600; index += 1) {
    registerCancellable("user-1", `req-${index.toString().padStart(8, "0")}`, new AbortController(), start);
  }
  // Losing the ability to cancel an old request is a smaller harm than
  // refusing a new answer, but the request just made must still be stoppable.
  assert.equal(cancelRequest("user-1", "req-00000599", start), true);
});

test("only simple ids are accepted", () => {
  assert.equal(isValidRequestId("a".repeat(8)), true);
  assert.equal(isValidRequestId("7f3c1f0e-5a6b-4c2d-9e8f-0a1b2c3d4e5f"), true);
  assert.equal(isValidRequestId("short"), false);
  assert.equal(isValidRequestId("has spaces here"), false);
  assert.equal(isValidRequestId("a".repeat(129)), false);
  assert.equal(isValidRequestId(undefined), false);
  assert.equal(isValidRequestId(42), false);
});

test("the ids the client generates are ids the server accepts", () => {
  // A mismatch here would make Stop silently do nothing.
  for (let index = 0; index < 20; index += 1) {
    assert.equal(isValidRequestId(newChatRequestId()), true);
  }
});

test("generated ids are distinct", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newChatRequestId()));
  assert.equal(ids.size, 200);
});

test("Stop tells the server, not just the browser", () => {
  const client = readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
  const stop = client.slice(client.indexOf("function stopGenerating()"));
  assert.match(stop.slice(0, 900), /\/api\/chat\/cancel/);
  // keepalive, because the page may be navigating away as Stop is pressed.
  assert.match(stop.slice(0, 900), /keepalive: true/);
});

test("the request announces the id Stop will name", () => {
  const client = readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
  assert.match(client, /"X-Chat-Request-Id": requestId/);
});

test("the route registers the request against the same header", () => {
  const route = readFileSync(
    new URL("../src/app/api/chat/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /request\.headers\.get\("x-chat-request-id"\)/);
  assert.match(route, /registerCancellable\(user\.id, requestId, readerLeft\)/);
  // Without this a finished request stays in the map until its TTL.
  assert.match(route, /unregister\?\.\(\)/);
});

test("the cancel route refuses an unauthenticated caller", () => {
  const route = readFileSync(
    new URL("../src/app/api/chat/cancel/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(route, /cancelRequest\(user\.id, requestId\)/);
});
