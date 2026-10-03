/*
 * Return paths after sign-in stay on the site: the check itself, and the
 * sign-in page and the server's check run with addresses that leave it. The
 * sign-in page runs through stub-uia11y-hooks.ts with the stub-auditfix-*
 * sign-in and router; the OAuth return address is in
 * small-fixes2-behaviour-auth.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { type ReactNode } from "react";
import { safeReturnPath } from "../src/lib/safe-return-path";
import { validateSafeReturnTo } from "../src/lib/security-guards";
import { WORKSPACE_LAST_ROUTE_STORAGE_KEY, WORKSPACE_PROJECT_STORAGE_KEY } from "../src/lib/workspace-session";
import { stubModule } from "./support/route-harness";
import { installDom } from "./support/stub-uia11y-dom";
import { elements, mount } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

const FALLBACK = "/workspaces";

test("a path on this site is kept, with its query and fragment", () => {
  assert.equal(safeReturnPath("/workspace/library", FALLBACK), "/workspace/library");
  assert.equal(
    safeReturnPath("/workspace/library?paper=abc&tab=evidence#top", FALLBACK),
    "/workspace/library?paper=abc&tab=evidence#top"
  );
});

test("anything that would leave the site falls back", () => {
  // A backslash and a tab were both measured leaving the site after sign-in:
  // browsers read "\" as "/" and drop tabs, so these became //example.com.
  const escapes = [
    "/\\example.com",
    "/\t/example.com",
    "/\n/example.com",
    "/\r/example.com",
    "//example.com",
    // Dot segments collapse into "//example.com" once resolved.
    "/.//example.com",
    "/a/..//example.com",
    "/%2e//example.com",
    "/././/example.com",
    "https://example.com",
    "javascript:alert(1)",
    "example.com",
    "",
  ];
  for (const value of escapes) {
    assert.equal(safeReturnPath(value, FALLBACK), FALLBACK, JSON.stringify(value));
  }
  assert.equal(safeReturnPath(null, FALLBACK), FALLBACK);
  assert.equal(safeReturnPath(undefined, FALLBACK), FALLBACK);
});

// The ones a browser was measured following off the site, and ones that stay.
const LEAVING = ["/\\example.com", "/\t/example.com", "//example.com", "/.//example.com", "/%2e//example.com", "https://example.com"];

test("the server's return check sends anything leaving the site to the fallback", () => {
  for (const value of LEAVING) assert.equal(validateSafeReturnTo(value, FALLBACK), FALLBACK, JSON.stringify(value));
  assert.equal(validateSafeReturnTo("/workspace/library?paper=1", FALLBACK), "/workspace/library?paper=1");
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://papertrend.test";
  try {
    // A full address on this site is taken as its path, which is checked too.
    assert.equal(validateSafeReturnTo("https://papertrend.test/workspace/chat#latest", FALLBACK), "/workspace/chat#latest");
    assert.equal(validateSafeReturnTo("https://papertrend.test/\\example.com", FALLBACK), FALLBACK);
    assert.equal(validateSafeReturnTo("https://papertrend.test/.//example.com", FALLBACK), FALLBACK);
  } finally {
    if (site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = site;
  }
});

/** Where the sign-in page sends someone already signed in, arriving with `returnTo`. */
async function loginRedirect(returnTo: string, storedRoute?: string) {
  const dom = installDom(`https://papertrend.test/login?returnTo=${encodeURIComponent(returnTo)}`);
  if (storedRoute) {
    dom.window.localStorage.setItem(WORKSPACE_PROJECT_STORAGE_KEY, "00000000-0000-4000-8000-0000000000a1");
    dom.window.localStorage.setItem(WORKSPACE_LAST_ROUTE_STORAGE_KEY, storedRoute);
  }
  globalThis.__auditfixAuth = { hydrated: true, user: { id: "00000000-0000-4000-8000-00000000000a" }, session: { access_token: "token" } };
  globalThis.__auditfixSearch = `returnTo=${encodeURIComponent(returnTo)}`;
  globalThis.__auditfixNavigations = [];
  try {
    const { default: LoginPage } = await import("../src/app/login/page");
    const content = elements(mount(LoginPage, {}).tree).find((found) => typeof found.type === "function" && found.type !== LoginPage)!;
    const page = mount(content.type as (props: unknown) => ReactNode, content.props);
    page.unmount();
    return globalThis.__auditfixNavigations;
  } finally {
    dom.restore();
  }
}

test("the sign-in page sends a signed-in reader back only to a path on this site", async () => {
  assert.deepEqual(await loginRedirect("/workspace/library?paper=abc"), ["/workspace/library?paper=abc"]);
  for (const value of LEAVING) assert.deepEqual(await loginRedirect(value), ["/workspaces"], JSON.stringify(value));
  // With a repository open last time, the fallback is where they were.
  assert.deepEqual(await loginRedirect("//example.com", "/workspace/chat"), ["/workspace/chat"]);
});

test("the image optimizer and the framework banner are off", async () => {
  const config = (await import("../next.config.mjs")).default as { images?: { unoptimized?: boolean }; poweredByHeader?: boolean };
  assert.equal(config.images?.unoptimized, true);
  assert.equal(config.poweredByHeader, false);
});

test("no generated path that is accepted leads off the site", () => {
  // Every combination of these pieces, four deep, after a leading slash. An
  // accepted result is followed the way a browser follows it, from a nested
  // page, and must stay on the same origin.
  const parts = ["/", ".", "..", "%2e", "%2E", "%2f", "a", "//", "evil.example", "@", "?", "#", ":", "%5c", "%09", " "];
  const escapes: string[] = [];
  let checked = 0;
  const visit = (prefix: string, depth: number) => {
    if (depth === 0) return;
    for (const part of parts) {
      const value = prefix + part;
      checked += 1;
      const out = safeReturnPath(value, FALLBACK);
      if (out !== FALLBACK && new URL(out, "https://site.example/deep/page").origin !== "https://site.example") {
        escapes.push(`${value} -> ${out}`);
      }
      visit(value, depth - 1);
    }
  };
  visit("/", 4);
  assert.ok(checked > 60_000, "the search covered the space");
  assert.deepEqual(escapes.slice(0, 5), []);
});
