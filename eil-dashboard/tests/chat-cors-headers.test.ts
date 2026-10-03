/*
 * These guard a failure that unit tests and server-side probes both miss: the
 * browser refuses the request before it is ever sent. Every live probe in this
 * work spoke to Cloud Run directly, which does no preflight, so a missing CORS
 * entry looked healthy from the outside while the real UI would have been dead.
 *
 * The chat page runs through stub-uia11y-hooks.ts against the stand-in fetch of
 * stub-uia11y-dom.ts (with the stub-auditfix-* sign-in, workspace, theme and
 * router), and what it sends is put to the routes' own preflight, signed in
 * against PGlite (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { type ReactNode } from "react";
import { routeHarness, stubModule } from "./support/route-harness";
import { resolveServerOnlyAsServer } from "./support/stub-bootsec-server-only";
import { installDom, settle } from "./support/stub-uia11y-dom";
import { elements, mount, textOf } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
resolveServerOnlyAsServer();
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

const SITE = "https://papertrend.test";
const DIRECT = "https://papertrend-web-abc123.a.run.app";
const ENV = { APP_ALLOWED_ORIGINS: SITE };
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };

type Sent = { url: string; headers: Record<string, string>; body?: string };

/** Asks a question on the chat page, then presses Stop while the answer is still coming. */
async function askThenStop(): Promise<{ chat: Sent; cancel: Sent }> {
  const dom = installDom(`${SITE}/workspace/chat`);
  const savedDirect = process.env.NEXT_PUBLIC_DIRECT_API_URL;
  process.env.NEXT_PUBLIC_DIRECT_API_URL = DIRECT;
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  // The answer never arrives, so the page is still waiting for it when Stop is pressed.
  const never = new Promise<void>(() => undefined);
  dom.window.respond = (url) => (url === `${DIRECT}/api/chat` ? { after: never } : url.startsWith("/api/chat/threads?") ? { body: { threads: [] } } : { status: 404, body: {} });
  try {
    const { default: ChatClient } = await import("../src/components/chat/ChatClient");
    const page = mount(ChatClient, {});
    await settle();
    const composer = elements(page.tree).find((found) => found.props["aria-label"] === "Message")!;
    (composer.props.onChange as (event: unknown) => void)({ target: { value: "What helps writing?" } });
    const form = () => elements(page.tree).find((found) => found.type === "form" && elements(found.props.children as ReactNode).some((inner) => inner.props["aria-label"] === "Message"))!;
    void (form().props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    await settle();
    const stop = elements(page.tree).find((found) => found.props["aria-label"] === "Stop generating");
    assert.ok(stop, `the page offers Stop while it waits: ${textOf(page.tree).slice(0, 80)}`);
    void (form().props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    await settle();
    page.unmount();
    const sent = (url: string): Sent => {
      const request = dom.window.requests.find((entry) => entry.url === url);
      assert.ok(request, `${url} was requested: ${dom.window.requests.map((entry) => entry.url).join(", ")}`);
      return { url, headers: request.init?.headers ?? {}, body: request.init?.body };
    };
    return { chat: sent(`${DIRECT}/api/chat`), cancel: sent(`${DIRECT}/api/chat/cancel`) };
  } finally {
    if (savedDirect === undefined) delete process.env.NEXT_PUBLIC_DIRECT_API_URL;
    else process.env.NEXT_PUBLIC_DIRECT_API_URL = savedDirect;
    dom.restore();
  }
}

const preflight = (path: string, headers: string[], origin = SITE) =>
  new Request(`${DIRECT}${path}`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": headers.join(", ") } });

test("Stop goes to the same origin that is running the answer, naming the answer the request named", async () => {
  // The chat request goes to the direct Cloud Run URL to avoid the Hosting
  // deadline. A relative cancel path would go to Hosting instead - a different
  // container, whose registry has never heard of this request.
  const { chat, cancel } = await askThenStop();
  assert.equal(chat.url, `${DIRECT}/api/chat`);
  assert.equal(cancel.url, `${DIRECT}/api/chat/cancel`);
  assert.match(chat.headers["X-Chat-Request-Id"] ?? "", /^[A-Za-z0-9_-]{8,128}$/);
  assert.deepEqual(JSON.parse(cancel.body ?? "{}"), { requestId: chat.headers["X-Chat-Request-Id"] });
  assert.equal(cancel.headers.Authorization, "Bearer reader-token");
});

test("every custom header the page sends is allowed by the preflight of the route it goes to", async () => {
  // A custom header missing from Access-Control-Allow-Headers fails the
  // preflight, which blocks the whole request rather than just the header.
  await routeHarness(ENV);
  const { chat, cancel } = await askThenStop();
  const chatRoute = await import("../src/app/api/chat/route");
  const cancelRoute = await import("../src/app/api/chat/cancel/route");
  const custom = (sent: Sent) => Object.keys(sent.headers).filter((name) => /^x-/i.test(name));
  assert.deepEqual(custom(chat), ["X-Chat-Request-Id"]);
  for (const [route, path, sent] of [[chatRoute, "/api/chat", chat], [cancelRoute, "/api/chat/cancel", cancel]] as const) {
    const answer = await route.OPTIONS(preflight(path, Object.keys(sent.headers)));
    assert.equal(answer.headers.get("access-control-allow-origin"), SITE, path);
    const allowed = (answer.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    for (const header of Object.keys(sent.headers)) {
      assert.ok(allowed.includes(header.toLowerCase()), `${path}: ${header} is sent but not allowed`);
    }
  }
  // An origin nobody listed gets no permission at all.
  const stranger = await cancelRoute.OPTIONS(preflight("/api/chat/cancel", ["X-Chat-Request-Id"], "https://evil.example"));
  assert.equal(stranger.headers.get("access-control-allow-origin"), null);
});

test("every cancel response carries the cross-origin headers, refusals included", async () => {
  // A response returned without them would be blocked by the browser.
  const { request, signIn } = await routeHarness(ENV);
  const reader = await signIn("00000000-0000-4000-8000-00000000000a");
  const { POST } = await import("../src/app/api/chat/cancel/route");
  const cancel = (headers: Record<string, string>, body: unknown) => POST(request("/api/chat/cancel", { headers: { origin: SITE, ...headers }, body }));
  const answers = [
    await cancel({}, { requestId: "request-0001" }),
    await cancel(reader, { requestId: "not valid!" }),
    await cancel(reader, { requestId: "request-0001" }),
  ];
  assert.deepEqual(answers.map((answer) => answer.status), [401, 400, 200]);
  for (const answer of answers) {
    assert.equal(answer.headers.get("access-control-allow-origin"), SITE);
    assert.match(answer.headers.get("access-control-allow-headers") ?? "", /X-Chat-Request-Id/);
  }
  assert.deepEqual(await answers[2].json(), { cancelled: false }, "an answer that already finished is not an error");
});
