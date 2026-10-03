/*
 * The sign-in provider's own return address (docs/32, long-term health): the
 * real AuthProvider, signing in with Supabase's OAuth, run through
 * stub-uia11y-hooks.ts against the stand-in window of stub-uia11y-dom.ts. The
 * Supabase client records the sign-in it is asked for
 * (stub-smallfix2-supabase.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import type { AuthContextValue } from "../src/types/auth";
import { stubModule } from "./support/route-harness";
import { installDom, settle } from "./support/stub-uia11y-dom";
import { elements, mount } from "./support/stub-uia11y-hooks";

stubModule("/src/lib/supabase.ts", new URL("./support/stub-smallfix2-supabase.ts", import.meta.url).href);
delete process.env.NEXT_PUBLIC_AUTH_PROVIDER;
(globalThis as { React?: typeof React }).React = React;

/** The address the OAuth provider is told to come back to, from a sign-in page at `href`. */
async function oauthReturn(href: string) {
  const dom = installDom(href);
  const visited: string[] = [];
  Object.assign(dom.window.location, { assign: (target: string) => void visited.push(target) });
  globalThis.__smallfix2OAuth = [];
  try {
    const { AuthProvider } = await import("../src/components/auth/AuthProvider");
    const provider = mount(AuthProvider, { children: null });
    await settle();
    const auth = elements(provider.tree)[0].props.value as AuthContextValue;
    await auth.signInWithProvider("google");
    provider.unmount();
    assert.deepEqual(visited, ["https://auth.papertrend.test/authorize"]);
    return globalThis.__smallfix2OAuth.map((request) => request.options?.redirectTo);
  } finally {
    dom.restore();
  }
}

test("signing in with a provider from the sign-in page comes back to a path on this site only", async () => {
  assert.deepEqual(await oauthReturn("https://papertrend.test/login?returnTo=%2Fworkspace%2Flibrary%3Fpaper%3Dabc"), [
    "https://papertrend.test/login?returnTo=%2Fworkspace%2Flibrary%3Fpaper%3Dabc",
  ]);
  for (const leaving of ["/\\example.com", "//example.com", "/.//example.com", "https://example.com"]) {
    assert.deepEqual(
      await oauthReturn(`https://papertrend.test/login?returnTo=${encodeURIComponent(leaving)}`),
      ["https://papertrend.test/workspaces"],
      leaving
    );
  }
});
