/*
 * The fourth batch of security fixes, run (docs/32, long-term health). Moved
 * to files of their own: the citation renderers (small-fixes2-behaviour-chat),
 * the insights request and answers in flight (small-fixes2-behaviour-chat-route),
 * refused and abandoned uploads (boot-security-behaviour-routes and
 * small-fixes2-behaviour-uploads), and the stuck Drive Picker
 * (small-fixes2-behaviour-upload-dialog). The sign-in panel runs through
 * stub-uia11y-hooks.ts with the stub-auditfix-auth.ts sign-in; the daily limit
 * against PGlite (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { type ReactNode } from "react";
import { safeCitationHref } from "../src/lib/safe-citation-href";
import { routeHarness, stubModule } from "./support/route-harness";
import { installDom, settle } from "./support/stub-uia11y-dom";
import { elements, mount, textOf } from "./support/stub-uia11y-hooks";

stubModule("/src/components/auth/AuthProvider.tsx", new URL("./support/stub-auditfix-auth.ts", import.meta.url).href);
stubModule("/src/components/theme/ThemeProvider.tsx", new URL("./support/stub-auditfix-theme.ts", import.meta.url).href);
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-4000-8000-00000000000a";

test("a citation link is an internal path or http(s), never a script", () => {
  assert.equal(safeCitationHref("/workspace/library?paper=abc"), "/workspace/library?paper=abc");
  assert.equal(safeCitationHref("/docs/chat"), "/docs/chat");
  assert.equal(safeCitationHref("https://example.org/paper"), "https://example.org/paper");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example", "", "not a url"]) {
    assert.equal(safeCitationHref(bad), "#", bad);
  }
});

test("parallel requests cannot all pass the daily limit: the count is taken under the person's lock", async () => {
  // The limit, its kinds and its refusal when it cannot be checked run in
  // guards-behaviour.test.ts. PGlite has one connection, so two requests
  // cannot race here; what is checked is that the lock is held when counting.
  const harness = await routeHarness();
  await harness.signIn(OWNER);
  const { AI_USAGE_COUNT_SQL, assertAndRecordAiUsage } = await import("../src/lib/security-guards");
  const held: Array<{ held: boolean }> = [];
  const state = globalThis.__papertrendRouteHarness!;
  const db = state.db;
  state.db = Object.assign(Object.create(db), {
    transaction: <T>(work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
      db.transaction((tx) =>
        work(Object.assign(Object.create(tx), {
          async query(sql: string, params?: unknown[]) {
            if (sql === AI_USAGE_COUNT_SQL) {
              const lock = await tx.query<{ held: boolean }>(
                `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()
                   AND ((classid::bigint << 32) | objid::bigint) = hashtextextended($1, 0)) AS held`,
                [`ai-usage:${OWNER}:chat_message`]
              );
              held.push(lock.rows[0]);
            }
            return tx.query(sql, params);
          },
        }))
      ),
  });
  try {
    await assertAndRecordAiUsage(OWNER, "chat_message", { route: "test" });
    await assertAndRecordAiUsage(OWNER, "chat_message", { route: "test" });
  } finally {
    state.db = db;
  }
  assert.deepEqual(held, [{ held: true }, { held: true }]);
  const recorded = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ai_usage_events WHERE owner_user_id = $1 AND usage_kind = 'chat_message'`, [OWNER]);
  assert.equal(recorded.rows[0].n, "2");
});

test("a new password needs ten characters; an existing one still signs in", async () => {
  const dom = installDom("https://papertrend.test/login");
  Object.assign(dom.window, { navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" } });
  const signedIn: string[] = [];
  globalThis.__auditfixAuth = {
    signInWithPassword: async (_email: string, password: string) => void signedIn.push(password),
    signUpWithPassword: async () => {
      throw Object.assign(new Error("Firebase: Error (auth/password-does-not-meet-requirements)."), { code: "auth/password-does-not-meet-requirements" });
    },
  };
  try {
    const { default: AuthPanel } = await import("../src/components/auth/AuthPanel");
    const panel = mount(AuthPanel, {});
    const password = () => elements(panel.tree).find((found) => found.props.id === "auth-password")!;
    const type = (id: string, value: string) => (elements(panel.tree).find((found) => found.props.id === id)!.props.onChange as (event: unknown) => void)({ target: { value } });
    const submit = async () => {
      const form = elements(panel.tree).find((found) => found.type === "form" && elements(found.props.children as ReactNode).some((inner) => inner.props.id === "auth-password"))!;
      await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
      await settle();
    };
    assert.equal(password().props.minLength, undefined, "signing in takes the password as it is");
    type("auth-email", "reader@papertrend.test");
    type("auth-password", "short1");
    await submit();
    assert.deepEqual(signedIn, ["short1"], "an existing shorter password still signs in");

    (elements(panel.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode) === "Create password account")!.props.onClick as () => void)();
    assert.equal(password().props.minLength, 10);
    assert.equal(password().props.placeholder, "At least 10 characters");
    await submit();
    assert.match(textOf(panel.tree), /Choose a longer password: at least 10 characters\./, "Firebase's refusal is put in words");
    panel.unmount();
  } finally {
    dom.restore();
  }
});

test("background jobs are queued with a Google-signed token, not the shared secret", async () => {
  // The callbacks' check runs, with signed tokens, in task-callers.test.ts.
  // They used to accept the shared worker secret, carried in every task's
  // headers and held by several services.
  const SECRET = "shared-worker-secret-for-tests";
  const env = {
    TASKS_OIDC_SERVICE_ACCOUNT: "papertrend-web@project.iam.gserviceaccount.com",
    APP_PUBLIC_URL: "https://papertrend.test/app",
    GOOGLE_CLOUD_PROJECT_ID: "papertrend-project",
    CLOUD_TASKS_QUEUE: "papertrend-jobs",
    WORKER_WEBHOOK_SECRET: SECRET,
    CRON_SECRET: SECRET,
  };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  const tasks: Array<{ headers: Record<string, string>; body: string }> = [];
  globalThis.fetch = (async (url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    if (String(url).includes("metadata.google.internal")) return new Response(JSON.stringify({ access_token: "metadata-access-token" }));
    tasks.push({ headers: init.headers ?? {}, body: init.body ?? "" });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const { enqueueRepositoryChatJob } = await import("../src/lib/repository-chat-jobs");
    const { enqueueSemanticMapJob } = await import("../src/lib/semantic-map-jobs");
    const { enqueueProjectReclassificationJob } = await import("../src/lib/project-reclassification-jobs");
    assert.equal(await enqueueRepositoryChatJob("job-1", OWNER, "https://papertrend.test"), true);
    assert.equal(await enqueueSemanticMapJob("map-1", OWNER, "https://papertrend.test"), true);
    assert.equal(await enqueueProjectReclassificationJob("job-2", OWNER, "https://papertrend.test"), true);
    assert.equal(tasks.length, 3);
    for (const task of tasks) {
      const { httpRequest } = (JSON.parse(task.body) as { task: { httpRequest: { oidcToken: unknown; headers: Record<string, string> } } }).task;
      assert.deepEqual(httpRequest.oidcToken, { serviceAccountEmail: env.TASKS_OIDC_SERVICE_ACCOUNT, audience: "https://papertrend.test" });
      assert.deepEqual(Object.keys(httpRequest.headers).map((name) => name.toLowerCase()), ["content-type"]);
      assert.ok(!JSON.stringify(task).includes(SECRET), "the secret is nowhere in the task");
    }
    // With no identity to sign as, nothing is queued, rather than falling back to the secret.
    delete process.env.TASKS_OIDC_SERVICE_ACCOUNT;
    delete process.env.APP_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(await enqueueSemanticMapJob("map-2", OWNER, "https://papertrend.test"), false);
    assert.equal(tasks.length, 3);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.match(read("package.json"), /"google-auth-library": "\^10\.9\.0"/, "a direct dependency, not a transitive one");
});

test("the Drive Picker opens in view, above the upload window, and its page Close sits above it", () => {
  // Google places the Picker from the page's scroll position; inside the
  // scrolling upload modal it opened above the screen. What the page does when
  // the Picker is stuck runs in small-fixes2-behaviour-upload-dialog.test.ts.
  const css = read("src/app/globals.css");
  const dialog = css.slice(css.indexOf(".picker-dialog {"));
  assert.match(dialog, /position: fixed !important;/);
  assert.match(dialog, /transform: translate\(-50%, -50%\) !important;/);
  assert.match(css, /\.picker-dialog-bg \{\s*position: fixed !important;/);
  assert.match(css, /\.drive-picker-close \{[\s\S]*?z-index: 2147483002;/);
});
